# Dumps the UI Automation view of the Stream Deck app's property-inspector
# webview (what NVDA, Narrator and Accessibility Insights read): every
# keyboard-focusable element under the "HWiNFO" panel document with its
# control type and Name. Read-only.
param([string]$Out)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$proc = Get-Process StreamDeck | Select-Object -First 1
$cond = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $proc.Id)
$wins = $A::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$rows = @()
foreach ($w in $wins) {
	$docs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
	foreach ($d in $docs) {
		$all = $d.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
		foreach ($e in $all) {
			try {
				$c = $e.Current
				if ($c.IsKeyboardFocusable -or $c.ControlType.ProgrammaticName -match 'Button|Edit|ComboBox|CheckBox|RadioButton|ListItem|Image') {
					$rows += [pscustomobject]@{ doc = $d.Current.Name; type = $c.ControlType.ProgrammaticName -replace 'ControlType\.', ''; name = $c.Name; focusable = $c.IsKeyboardFocusable; offscreen = $c.IsOffscreen }
				}
			} catch {}
		}
	}
}
"documents: $(($rows | Select-Object -ExpandProperty doc -Unique) -join ' | ')"
"elements: $($rows.Count); focusable without a name: $(($rows | Where-Object { $_.focusable -and [string]::IsNullOrWhiteSpace($_.name) }).Count)"
if ($Out) { $rows | ConvertTo-Json -Depth 3 | Set-Content $Out -Encoding utf8 }
$rows | Where-Object { $_.focusable } | Select-Object -First 60 type, name | Format-Table -AutoSize -Wrap
