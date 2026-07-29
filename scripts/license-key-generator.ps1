Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$generator = Join-Path $PSScriptRoot "generate-license.mjs"
$privateKey = Join-Path $projectRoot ".license-private\license-private.pem"
$script:licenseKey = ""
$script:licensePayload = $null

$form = New-Object System.Windows.Forms.Form
$form.Text = "SMART PRINT - Developer License Generator"
$form.ClientSize = New-Object System.Drawing.Size(820, 730)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(13, 19, 26)
$form.ForeColor = [System.Drawing.Color]::White
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

function Add-Label($text, $x, $y, $width = 350) {
  $control = New-Object System.Windows.Forms.Label
  $control.Text = $text; $control.Location = New-Object System.Drawing.Point($x, $y)
  $control.Size = New-Object System.Drawing.Size($width, 23); $form.Controls.Add($control); return $control
}
function Add-TextBox($x, $y, $width = 360) {
  $control = New-Object System.Windows.Forms.TextBox
  $control.Location = New-Object System.Drawing.Point($x, $y); $control.Size = New-Object System.Drawing.Size($width, 28)
  $form.Controls.Add($control); return $control
}
function Add-Button($text, $x, $y, $width = 120) {
  $control = New-Object System.Windows.Forms.Button
  $control.Text = $text; $control.Location = New-Object System.Drawing.Point($x, $y); $control.Size = New-Object System.Drawing.Size($width, 38)
  $control.FlatStyle = "Flat"; $control.BackColor = [System.Drawing.Color]::FromArgb(28, 38, 49); $control.ForeColor = [System.Drawing.Color]::White
  $form.Controls.Add($control); return $control
}
function Set-Status($message, $error = $false) {
  $statusLabel.Text = $message
  $statusLabel.ForeColor = if ($error) { [System.Drawing.Color]::Salmon } else { [System.Drawing.Color]::LightGreen }
}
function Get-SafeCustomerFileName {
  $name = $customerBox.Text.Trim()
  foreach ($invalid in [System.IO.Path]::GetInvalidFileNameChars()) { $name = $name.Replace([string]$invalid, "-") }
  if ([string]::IsNullOrWhiteSpace($name)) { return "customer" }
  return $name
}
function Get-WhatsAppMessage {
  $expiry = if ($script:licensePayload.expiresAt) { ([datetime]$script:licensePayload.expiresAt).ToString("dd-MMM-yyyy") } else { "Lifetime" }
  return "SMART PRINT License`r`n`r`nCustomer`r`n$($script:licensePayload.customer)`r`n`r`nMachine ID`r`n$($script:licensePayload.machine)`r`n`r`nValidity`r`n$($script:licensePayload.licenseType)`r`n`r`nExpiry`r`n$expiry`r`n`r`nLicense Key`r`n$script:licenseKey"
}

$brand = Add-Label "SMART PRINT" 24 18 500
$brand.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Bold)
$company = Add-Label "IM TECHNOLOGY  |  Developer License Generator" 26 58 550
$company.ForeColor = [System.Drawing.Color]::FromArgb(80, 210, 225)

Add-Label "Customer Name" 25 98
$customerBox = Add-TextBox 25 123 370
Add-Label "Machine ID" 425 98
$machineBox = Add-TextBox 425 123 370
$machineBox.CharacterCasing = "Upper"

Add-Label "License Type" 25 170
$typeBox = New-Object System.Windows.Forms.ComboBox
$typeBox.Location = New-Object System.Drawing.Point(25, 195); $typeBox.Size = New-Object System.Drawing.Size(370, 28); $typeBox.DropDownStyle = "DropDownList"
[void]$typeBox.Items.AddRange(@("Trial", "15 Days", "30 Days", "90 Days", "180 Days", "1 Year", "2 Years", "3 Years", "Lifetime", "Custom")); $typeBox.SelectedItem = "1 Year"
$form.Controls.Add($typeBox)

$customPanel = New-Object System.Windows.Forms.Panel
$customPanel.Location = New-Object System.Drawing.Point(425, 170); $customPanel.Size = New-Object System.Drawing.Size(370, 78); $customPanel.Visible = $false
$form.Controls.Add($customPanel)
$issueLabel = New-Object System.Windows.Forms.Label; $issueLabel.Text = "Issue Date"; $issueLabel.Location = New-Object System.Drawing.Point(0, 0); $issueLabel.Size = New-Object System.Drawing.Size(170, 22); $customPanel.Controls.Add($issueLabel)
$expiryLabel = New-Object System.Windows.Forms.Label; $expiryLabel.Text = "Expiry Date"; $expiryLabel.Location = New-Object System.Drawing.Point(190, 0); $expiryLabel.Size = New-Object System.Drawing.Size(170, 22); $customPanel.Controls.Add($expiryLabel)
$issuePicker = New-Object System.Windows.Forms.DateTimePicker; $issuePicker.Format = "Custom"; $issuePicker.CustomFormat = "dd-MMM-yyyy"; $issuePicker.Location = New-Object System.Drawing.Point(0, 25); $issuePicker.Size = New-Object System.Drawing.Size(170, 28); $customPanel.Controls.Add($issuePicker)
$expiryPicker = New-Object System.Windows.Forms.DateTimePicker; $expiryPicker.Format = "Custom"; $expiryPicker.CustomFormat = "dd-MMM-yyyy"; $expiryPicker.Location = New-Object System.Drawing.Point(190, 25); $expiryPicker.Size = New-Object System.Drawing.Size(170, 28); $expiryPicker.Value = (Get-Date).AddYears(1); $customPanel.Controls.Add($expiryPicker)

$generateButton = Add-Button "Generate" 25 258 150
$generateButton.BackColor = [System.Drawing.Color]::FromArgb(0, 176, 196); $generateButton.ForeColor = [System.Drawing.Color]::Black
$againButton = Add-Button "Generate Again" 185 258 150
$clearButton = Add-Button "Clear" 345 258 100

Add-Label "Generated License Key" 25 314
$outputBox = Add-TextBox 25 340 770
$outputBox.Multiline = $true; $outputBox.ReadOnly = $true; $outputBox.ScrollBars = "Vertical"; $outputBox.Size = New-Object System.Drawing.Size(770, 135)

$copyButton = Add-Button "Copy Key" 25 495 140
$licButton = Add-Button "Save LIC" 175 495 140
$txtButton = Add-Button "Save TXT" 325 495 140
$whatsAppButton = Add-Button "Copy WhatsApp Message" 475 495 220

$summaryBox = New-Object System.Windows.Forms.TextBox
$summaryBox.Location = New-Object System.Drawing.Point(25, 550); $summaryBox.Size = New-Object System.Drawing.Size(770, 105)
$summaryBox.Multiline = $true; $summaryBox.ReadOnly = $true; $summaryBox.BackColor = [System.Drawing.Color]::FromArgb(19, 27, 35); $summaryBox.ForeColor = [System.Drawing.Color]::LightGray
$form.Controls.Add($summaryBox)
$statusLabel = Add-Label "Ready. Private signing material stays in the developer project only." 25 675 770
$statusLabel.ForeColor = [System.Drawing.Color]::LightGray

$typeBox.Add_SelectedIndexChanged({ $customPanel.Visible = $typeBox.SelectedItem -eq "Custom" })
$generateAction = {
  $machine = $machineBox.Text.Trim().ToUpperInvariant(); $customer = $customerBox.Text.Trim(); $licenseType = [string]$typeBox.SelectedItem
  if (-not $customer) { Set-Status "Customer Name is required." $true; return }
  if ($machine -notmatch '^[A-F0-9]{20}$') { Set-Status "Machine ID must be exactly 20 hexadecimal characters (0-9 and A-F)." $true; return }
  if (-not (Test-Path -LiteralPath $privateKey)) { Set-Status "Private signing key was not found in .license-private." $true; return }
  $days = switch ($licenseType) { "Trial" { 7 } "15 Days" { 15 } "30 Days" { 30 } "90 Days" { 90 } "180 Days" { 180 } "1 Year" { 365 } "2 Years" { 730 } "3 Years" { 1095 } default { $null } }
  $arguments = @($generator, "--machine=$machine", "--customer=$customer", "--license-type=$licenseType")
  if ($licenseType -eq "Custom") {
    if ($expiryPicker.Value.Date -le $issuePicker.Value.Date) { Set-Status "Custom Expiry Date must be after Issue Date." $true; return }
    $arguments += "--issued=$($issuePicker.Value.Date.ToString('yyyy-MM-dd'))"; $arguments += "--expires=$($expiryPicker.Value.Date.AddDays(1).AddSeconds(-1).ToString('o'))"
  } elseif ($null -ne $days) { $arguments += "--days=$days" }
  try {
    $result = & node @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`r`n") }
    $script:licenseKey = ($result | Select-Object -Last 1).Trim()
    if ($script:licenseKey -notmatch '^PD1\.') { throw "Generator returned an invalid result." }
    $encoded = $script:licenseKey.Split('.')[1].Replace('-', '+').Replace('_', '/'); while ($encoded.Length % 4) { $encoded += '=' }
    $script:licensePayload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
    $outputBox.Text = $script:licenseKey
    $expiryText = if ($script:licensePayload.expiresAt) { ([datetime]$script:licensePayload.expiresAt).ToString("dd-MMM-yyyy") } else { "Lifetime" }
    $summaryBox.Text = "Customer: $customer`r`nMachine ID: $machine`r`nLicense Type: $licenseType`r`nIssue Date: $(([datetime]$script:licensePayload.issuedAt).ToString('dd-MMM-yyyy'))    Expiry: $expiryText"
    Set-Status "License generated and cryptographically signed."
  } catch { Set-Status "Generation failed: $($_.Exception.Message)" $true }
}
$generateButton.Add_Click($generateAction); $againButton.Add_Click($generateAction)
$clearButton.Add_Click({ $customerBox.Clear(); $machineBox.Clear(); $outputBox.Clear(); $summaryBox.Clear(); $script:licenseKey = ""; $script:licensePayload = $null; Set-Status "Cleared." })
$copyButton.Add_Click({ if ($script:licenseKey) { [Windows.Forms.Clipboard]::SetText($script:licenseKey); Set-Status "License key copied." } })
$licButton.Add_Click({
  if (-not $script:licenseKey) { Set-Status "Generate a license first." $true; return }
  $dialog = New-Object Windows.Forms.SaveFileDialog; $dialog.Filter = "SMART PRINT License (*.lic)|*.lic"; $dialog.FileName = "$(Get-SafeCustomerFileName).lic"
  if ($dialog.ShowDialog() -eq "OK") { [IO.File]::WriteAllText($dialog.FileName, $script:licenseKey, (New-Object Text.UTF8Encoding($false))); Set-Status "LIC file saved: $($dialog.FileName)" }
})
$txtButton.Add_Click({
  if (-not $script:licenseKey) { Set-Status "Generate a license first." $true; return }
  $dialog = New-Object Windows.Forms.SaveFileDialog; $dialog.Filter = "Text File (*.txt)|*.txt"; $dialog.FileName = "$(Get-SafeCustomerFileName).txt"
  if ($dialog.ShowDialog() -eq "OK") { [IO.File]::WriteAllText($dialog.FileName, (Get-WhatsAppMessage), (New-Object Text.UTF8Encoding($false))); Set-Status "TXT file saved: $($dialog.FileName)" }
})
$whatsAppButton.Add_Click({ if ($script:licenseKey) { [Windows.Forms.Clipboard]::SetText((Get-WhatsAppMessage)); Set-Status "Ready-to-send WhatsApp message copied." } else { Set-Status "Generate a license first." $true } })

[void]$form.ShowDialog()
