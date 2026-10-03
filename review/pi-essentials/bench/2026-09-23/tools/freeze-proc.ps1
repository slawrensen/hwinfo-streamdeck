# Suspends (never kills) one process by name for -Seconds, then resumes it:
# HWiNFO64 frozen = shared memory stops advancing, the real "stale" state.
param([Parameter(Mandatory)][string]$Name, [int]$Seconds = 25)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Nt2 {
	[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
	[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
$proc = Get-Process $Name | Select-Object -First 1
try {
	[Nt2]::NtSuspendProcess($proc.Handle) | Out-Null
	"suspended $Name pid $($proc.Id) at $((Get-Date).ToUniversalTime().ToString('HH:mm:ss'))Z"
	Start-Sleep -Seconds $Seconds
} finally {
	[Nt2]::NtResumeProcess($proc.Handle) | Out-Null
	"resumed at $((Get-Date).ToUniversalTime().ToString('HH:mm:ss'))Z"
}
