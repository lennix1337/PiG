//go:build windows

package tools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// BenchmarkWin_ConfiguredGitBash measures the same real shell command with the
// wrapper and with explicitly configured direct Bash. Environment capture is
// one-time setup; both variants use the normal suspended/job-tracked executor.
func BenchmarkWin_ConfiguredGitBash(b *testing.B) {
	directBash := requireWinShellTestDependencies(b)
	dir := b.TempDir()
	files := map[string]string{
		"answer.txt": "answer=4\n",
		"verify.cjs": "const fs=require('node:fs');if(fs.readFileSync('answer.txt','utf8')!=='answer=4\\n')process.exit(1);console.log('replay-ok');\n",
		"env.cjs":    "process.stdout.write(JSON.stringify(process.env));",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			b.Fatal(err)
		}
	}
	var output strings.Builder
	_, err := CreateLocalBashOperations(nil).Exec(b.Context(), "node env.cjs", dir, BashOperationsExecOptions{
		OnData: func(chunk []byte) { output.Write(chunk) },
	})
	if err != nil {
		b.Fatal(err)
	}
	var environment map[string]string
	if err := json.Unmarshal([]byte(output.String()), &environment); err != nil {
		b.Fatal("decode wrapper environment:", err)
	}
	keys := map[string]bool{"PATH": true, "HOME": true, "MSYSTEM": true, "PLINK_PROTOCOL": true, "EXEPATH": true}
	prepared := make([]string, 0, len(os.Environ())+len(keys))
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !keys[strings.ToUpper(key)] {
			prepared = append(prepared, entry)
		}
	}
	for key := range keys {
		if value, ok := environment[key]; ok {
			prepared = append(prepared, key+"="+value)
		}
	}
	for _, variant := range []struct{ name, path string }{
		{"launcher", ""},
		{"direct", directBash},
	} {
		b.Run(variant.name, func(b *testing.B) {
			operations := CreateLocalBashOperations(&LocalBashOptions{ShellPath: variant.path})
			options := BashOperationsExecOptions{OnData: func(chunk []byte) { output.Write(chunk) }}
			if variant.name == "direct" {
				options.Env = prepared
			}
			b.ReportAllocs()
			for b.Loop() {
				output.Reset()
				result, err := operations.Exec(b.Context(), "node verify.cjs", dir, options)
				if err != nil || result.ExitCode == nil || *result.ExitCode != 0 || strings.TrimSpace(output.String()) != "replay-ok" {
					b.Fatalf("command failed: result=%+v err=%v", result, err)
				}
			}
		})
	}
}
