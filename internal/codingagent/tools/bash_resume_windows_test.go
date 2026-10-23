//go:build windows

package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows"
)

// A suspended shell must join its job before it can run or spawn descendants.
// Upstream shell.ts kills the complete process tree on cancellation; resuming
// earlier would let Git for Windows' launcher spawn outside the job.
func TestWin_ResumePreservesJobBeforeExecution(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "echo resumed")
	var output bytes.Buffer
	cmd.Stdout = &output
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		releaseProcessGroup(cmd.Process)
	})
	attachProcessGroup(cmd.Process)
	if _, ok := bashJobs.Load(cmd.Process.Pid); !ok {
		t.Fatal("shell resumed without a tracked job")
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "resumed\r\n" {
		t.Fatalf("output = %q", got)
	}
}

func TestWin_ResumeRejectsInvalidProcess(t *testing.T) {
	if resumeProcess(0) {
		t.Fatal("invalid process was reported resumed")
	}
}

func TestWin_ResumeRejectsExitedProcess(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit 0")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	if resumeProcess(cmd.Process.Pid) {
		t.Fatal("exited process was reported resumed")
	}
}

func TestWin_ResumeFailureKillsSuspendedShell(t *testing.T) {
	original := ntResumeBashProcess
	ntResumeBashProcess = windows.NewLazySystemDLL("ntdll.dll").NewProc("PiGTestMissingResumeProcess")
	t.Cleanup(func() { ntResumeBashProcess = original })
	cmd := exec.Command("cmd", "/c", "exit 0")
	setProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		releaseProcessGroup(cmd.Process)
	})
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = windows.CloseHandle(h) }()
	attachProcessGroup(cmd.Process)
	if status, err := windows.WaitForSingleObject(h, 3000); err != nil || status != windows.WAIT_OBJECT_0 {
		t.Fatalf("failed resume left suspended shell alive: status=%d, err=%v", status, err)
	}
	if err := cmd.Wait(); err == nil {
		t.Fatal("unresumed shell exited successfully instead of being killed")
	}
}

func requireWinShellTestDependencies(t testing.TB) string {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatalf("Windows shell tests require Node on PATH: %v", err)
	}
	if _, err := exec.LookPath("bash"); err != nil {
		t.Fatalf("Windows shell tests require Git Bash on PATH: %v", err)
	}
	direct := filepath.Join(os.Getenv("ProgramFiles"), "Git", "usr", "bin", "bash.exe")
	if info, err := os.Stat(direct); err != nil || info.IsDir() {
		t.Fatalf("Windows direct-shell tests require Git for Windows at %s (stat: %v)", direct, err)
	}
	return direct
}

// Both cancellation and timeout must reap the Node child and its grandchild,
// not merely return an error after killing the shell.
func TestWin_ResumeShellReapsDescendants(t *testing.T) {
	directBash := requireWinShellTestDependencies(t)
	for _, shell := range []struct{ name, path string }{
		{"launcher", ""},
		{"direct", directBash},
	} {
		for _, mode := range []string{"cancel", "timeout"} {
			t.Run(shell.name+"/"+mode, func(t *testing.T) {
				dir := t.TempDir()
				script := `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','inherit']});
child.stdout.once('data',()=>console.log(JSON.stringify([process.pid,child.pid])));
setInterval(()=>{},1000);
`
				if err := os.WriteFile(filepath.Join(dir, "tree.cjs"), []byte(script), 0o600); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				var timeout *float64
				fire := cancel
				if mode == "timeout" {
					timeout = new(1.0)
					testHookTimeoutTimer = func(time.Duration) (<-chan time.Time, func()) {
						ch := make(chan time.Time, 1)
						fire = func() { ch <- time.Now() }
						return ch, func() {}
					}
					t.Cleanup(func() { testHookTimeoutTimer = nil })
				}
				var output strings.Builder
				var handles []windows.Handle
				var captureErr error
				result, err := CreateLocalBashOperations(&LocalBashOptions{ShellPath: shell.path}).Exec(ctx, "node tree.cjs", dir, BashOperationsExecOptions{
					Timeout: timeout,
					OnData: func(data []byte) {
						output.Write(data)
						if !strings.Contains(output.String(), "\n") || len(handles) != 0 || captureErr != nil {
							return
						}
						var pids []uint32
						captureErr = json.Unmarshal([]byte(strings.TrimSpace(output.String())), &pids)
						if captureErr == nil && len(pids) != 2 {
							captureErr = errors.New("expected parent and grandchild PIDs")
						}
						for _, pid := range pids {
							if captureErr != nil {
								break
							}
							var h windows.Handle
							h, captureErr = windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
							if captureErr == nil {
								handles = append(handles, h)
							}
						}
						fire()
					},
				})
				defer func() {
					for _, h := range handles {
						_ = windows.CloseHandle(h)
					}
				}()
				if captureErr != nil || len(handles) != 2 {
					t.Fatalf("capture: %v; handles=%d; output=%q", captureErr, len(handles), output.String())
				}
				want := "aborted"
				if mode == "timeout" {
					want = "timeout:1"
				}
				if err == nil || err.Error() != want || result.ExitCode != nil {
					t.Fatalf("result=%+v, err=%v, want %s", result, err, want)
				}
				for _, h := range handles {
					if status, err := windows.WaitForSingleObject(h, 0); err != nil || status != windows.WAIT_OBJECT_0 {
						began := time.Now()
						later, waitErr := windows.WaitForSingleObject(h, 5000)
						t.Fatalf("descendant not signalled at return: status=%d, err=%v; after %v: status=%d, err=%v", status, err, time.Since(began), later, waitErr)
					}
				}
			})
		}
	}
}

// Measure only resume, excluding shell execution, job creation, and process
// startup. Use the same compiler and workload before and after the change.
func BenchmarkWin_ResumeSuspendedProcess(b *testing.B) {
	b.ReportAllocs()
	for b.Loop() {
		b.StopTimer()
		cmd := exec.Command("cmd", "/c", "exit 0")
		setProcessGroup(cmd)
		if err := cmd.Start(); err != nil {
			b.Fatal(err)
		}
		job, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			b.Fatal(err)
		}
		h, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
		if err == nil {
			err = windows.AssignProcessToJobObject(job, h)
			_ = windows.CloseHandle(h)
		}
		if err != nil {
			_ = windows.CloseHandle(job)
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			b.Fatal(err)
		}
		b.StartTimer()
		resumed := resumeProcess(cmd.Process.Pid)
		b.StopTimer()
		if !resumed {
			_ = cmd.Process.Kill()
		}
		err = cmd.Wait()
		_ = windows.CloseHandle(job)
		if !resumed || err != nil {
			b.Fatalf("resumed=%v, wait=%v", resumed, err)
		}
		b.StartTimer()
	}
}
