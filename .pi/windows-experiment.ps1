param([ValidateSet('baseline-resume','patched-resume','safety','failure-guard','direct-contract','direct-benchmark','direct-profile','vet','build')][string]$Check)
$ErrorActionPreference = 'Stop'
$evidence = 'C:/projetos/local-validation/performance/pi-pig-tools'
$agent = Join-Path $evidence 'fork-test-home'
New-Item -ItemType Directory -Force -Path $agent | Out-Null
$env:PIG_CODING_AGENT_DIR = $agent
$env:PI_CODING_AGENT_DIR = $agent
$env:PIG_HOME = $agent
$env:PI_HOME = $agent
switch ($Check) {
    { $_ -in 'baseline-resume','patched-resume' } {
        & go test -trimpath -o "$evidence/$Check.test.exe" ./internal/codingagent/tools -run '^TestWin_Resume(Preserves|Rejects)' -bench '^BenchmarkWin_ResumeSuspendedProcess$' -benchtime=20x -cpuprofile "$evidence/$Check.cpu.pprof" -memprofile "$evidence/$Check.mem.pprof" -timeout 90s -v 2>&1 | Tee-Object -FilePath "$evidence/$Check.log"
    }
    'safety' {
        & go test -trimpath ./internal/codingagent/tools -run '^(TestWin_|TestBash(KillsProcessGroupOnCancel|Timeout|AbortReturnsBufferedOutput|SucceedsWithSimpleCommand|ExitCodeAsError|StreamsLiveOutput)|TestLocalShellOperationsCaptureEveryLineOfAChild)' -timeout 120s -v 2>&1 | Tee-Object -FilePath "$evidence/patched-safety.log"
    }
    'failure-guard' { & go test -trimpath ./internal/codingagent/tools -run '^TestWin_ResumeFailureKillsSuspendedShell$' -timeout 15s -v }
    'direct-contract' { & node .pi/verify-direct-shell.mjs (Join-Path $evidence ('direct-shell-contract-' + [guid]::NewGuid().ToString())) }
    'direct-benchmark' { & node .pi/compare-direct-shell.mjs (Join-Path $evidence ('direct-shell-native-' + [guid]::NewGuid().ToString())) 6 }
    'direct-profile' {
        & go test -trimpath -o "$evidence/direct-shell.test.exe" ./internal/codingagent/tools -run '^$' -bench '^BenchmarkWin_ConfiguredGitBash$' -benchtime=20x -cpuprofile "$evidence/direct-shell.cpu.pprof" -memprofile "$evidence/direct-shell.mem.pprof" -timeout 60s -v 2>&1 | Tee-Object -FilePath "$evidence/direct-shell-profile.log"
    }
    'vet' { & go vet ./internal/codingagent/tools }
    'build' { & go build -trimpath -o "$evidence/pig-source-patched.exe" ./cmd/pig }
}
exit $LASTEXITCODE
