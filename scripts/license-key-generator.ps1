Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$generator = Join-Path $PSScriptRoot "generate-license.mjs"
$privateKey = Join-Path $projectRoot ".license-private\license-private.pem"

$form = New-Object System.Windows.Forms.Form
$form.Text = "PrintDesk Licence Key Generator"
$form.Size = New-Object System.Drawing.Size(720, 570)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(16, 22, 29)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

function Add-Label($text, $x, $y) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text; $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size(650, 24); $form.Controls.Add($label)
}
function Add-TextBox($x, $y, $width = 650) {
  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point($x, $y); $box.Size = New-Object System.Drawing.Size($width, 28)
  $form.Controls.Add($box); return $box
}

Add-Label "Customer Machine ID" 25 25
$machineBox = Add-TextBox 25 52
$machineBox.CharacterCasing = "Upper"

Add-Label "Customer Name" 25 92
$nameBox = Add-TextBox 25 119

Add-Label "Validity" 25 159
$validityBox = Add-TextBox 25 186 130
$validityBox.Text = "12"
$unitBox = New-Object System.Windows.Forms.ComboBox
$unitBox.Location = New-Object System.Drawing.Point(170, 186); $unitBox.Size = New-Object System.Drawing.Size(190, 28)
$unitBox.DropDownStyle = "DropDownList"
[void]$unitBox.Items.AddRange(@("Days", "Months", "Years", "Lifetime")); $unitBox.SelectedItem = "Months"
$form.Controls.Add($unitBox)

$generateButton = New-Object System.Windows.Forms.Button
$generateButton.Text = "Generate && Copy Licence Key"
$generateButton.Location = New-Object System.Drawing.Point(25, 238); $generateButton.Size = New-Object System.Drawing.Size(335, 42)
$generateButton.BackColor = [System.Drawing.Color]::FromArgb(0, 190, 210); $generateButton.ForeColor = [System.Drawing.Color]::Black
$generateButton.FlatStyle = "Flat"; $form.Controls.Add($generateButton)

Add-Label "Generated Licence Key" 25 300
$outputBox = New-Object System.Windows.Forms.TextBox
$outputBox.Location = New-Object System.Drawing.Point(25, 327); $outputBox.Size = New-Object System.Drawing.Size(650, 125)
$outputBox.Multiline = $true; $outputBox.ReadOnly = $true; $outputBox.ScrollBars = "Vertical"
$form.Controls.Add($outputBox)

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Location = New-Object System.Drawing.Point(25, 470); $statusLabel.Size = New-Object System.Drawing.Size(650, 45)
$statusLabel.ForeColor = [System.Drawing.Color]::LightGray; $form.Controls.Add($statusLabel)

$unitBox.Add_SelectedIndexChanged({ $validityBox.Enabled = $unitBox.SelectedItem -ne "Lifetime" })
$generateButton.Add_Click({
  $machine = $machineBox.Text.Trim().ToUpperInvariant()
  $customer = $nameBox.Text.Trim()
  if (-not $machine -or -not $customer) { [System.Windows.Forms.MessageBox]::Show("Machine ID and Customer Name are required.", "Missing details", "OK", "Warning"); return }
  if (-not (Test-Path -LiteralPath $privateKey)) { [System.Windows.Forms.MessageBox]::Show("Private signing key was not found. Keep the .license-private folder beside the project.", "Signing key missing", "OK", "Error"); return }
  $arguments = @($generator, "--machine=$machine", "--customer=$customer")
  if ($unitBox.SelectedItem -ne "Lifetime") {
    $amount = 0
    if (-not [int]::TryParse($validityBox.Text, [ref]$amount) -or $amount -le 0) { [System.Windows.Forms.MessageBox]::Show("Enter a positive validity number.", "Invalid validity", "OK", "Warning"); return }
    $argumentName = switch ($unitBox.SelectedItem) { "Days" { "days" } "Months" { "months" } "Years" { "years" } }
    $arguments += "--$argumentName=$amount"
  }
  try {
    $result = & node @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`r`n") }
    $key = ($result | Select-Object -Last 1).Trim()
    if (-not $key.StartsWith("PD1.")) { throw "Generator returned an invalid result." }
    $outputBox.Text = $key
    [System.Windows.Forms.Clipboard]::SetText($key)
    $statusLabel.Text = "Licence created and copied to clipboard. Give only this key to the customer."
    $statusLabel.ForeColor = [System.Drawing.Color]::LightGreen
  } catch {
    $statusLabel.Text = "Error: $($_.Exception.Message)"; $statusLabel.ForeColor = [System.Drawing.Color]::Salmon
  }
})

[void]$form.ShowDialog()
