param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$extension = [IO.Path]::GetExtension($InputPath).ToLowerInvariant()
$app = $null
$document = $null
try {
  if ($extension -in @('.doc', '.docx', '.rtf', '.txt', '.odt')) {
    $app = New-Object -ComObject Word.Application
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $document = $app.Documents.Open($InputPath, $false, $true)
    $document.SaveAs([ref]$OutputPath, [ref]17)
  } elseif ($extension -in @('.xls', '.xlsx', '.xlsm', '.csv', '.ods')) {
    $app = New-Object -ComObject Excel.Application
    $app.Visible = $false
    $app.DisplayAlerts = $false
    $document = $app.Workbooks.Open($InputPath, 0, $true)
    $document.ExportAsFixedFormat(0, $OutputPath)
  } elseif ($extension -in @('.ppt', '.pptx', '.odp')) {
    $app = New-Object -ComObject PowerPoint.Application
    $document = $app.Presentations.Open($InputPath, $true, $false, $false)
    $document.SaveAs($OutputPath, 32)
  } else {
    throw "Unsupported Office file: $extension"
  }
} finally {
  if ($document) { try { $document.Close() } catch {} }
  if ($app) { try { $app.Quit() } catch {} }
  if ($document) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
