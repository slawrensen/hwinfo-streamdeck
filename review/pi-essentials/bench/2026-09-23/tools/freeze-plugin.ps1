# B2.5 hung-plugin leg: suspends (never kills) the live plugin process for
# -Seconds, then resumes it. A suspended plugin keeps its socket open, so the
# app still believes it is running: the one state the panel's "The plugin is
# not responding" line exists for.
param([int]$Seconds = 12)
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Nt {
	[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
	[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
}
'@
$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'Plugins\\com\.lawrensen\.hwinfo\.sdPlugin' } | Select-Object -First 1
$proc = Get-Process -Id $p.ProcessId
try {
	[Nt]::NtSuspendProcess($proc.Handle) | Out-Null
	"suspended pid $($p.ProcessId) at $((Get-Date).ToUniversalTime().ToString('HH:mm:ss.fff'))Z"
	Start-Sleep -Seconds $Seconds
} finally {
	[Nt]::NtResumeProcess($proc.Handle) | Out-Null
	"resumed at $((Get-Date).ToUniversalTime().ToString('HH:mm:ss.fff'))Z"
}
