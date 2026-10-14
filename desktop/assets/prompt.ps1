# Loaded after PowerShell's regular profiles. Never edits the user's profile.
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$global:TerminalOriginalPrompt = $function:prompt
function global:prompt {
    # Invoke the original prompt first so its content, hooks and side effects survive.
    $originalText = if ($global:TerminalOriginalPrompt) { & $global:TerminalOriginalPrompt } else { "PS $(Get-Location)> " }
    $savedExitCode = $global:LASTEXITCODE
    $color = '#28c840'
    try {
        $preferences = [IO.File]::ReadAllText($env:MAC_STYLE_TERMINAL_SETTINGS) | ConvertFrom-Json
        if ($preferences.username_color -match '^#[0-9a-fA-F]{6}$') { $color = $preferences.username_color }
    } catch {}
    $r = [Convert]::ToInt32($color.Substring(1,2),16)
    $g = [Convert]::ToInt32($color.Substring(3,2),16)
    $b = [Convert]::ToInt32($color.Substring(5,2),16)
    $esc = [char]27
    $location = Get-Location
    if ($location.Provider.Name -eq 'FileSystem') {
        $uri = [Uri]::new($location.Path + [IO.Path]::DirectorySeparatorChar)
        [Console]::Write("${esc}]7;$($uri.AbsoluteUri)${esc}\")
    }
    [Console]::Write("${esc}]666;vte.ext.macstyle.prompt-idle=1${esc}\")
    $global:LASTEXITCODE = $savedExitCode
    "${esc}[38;2;${r};${g};${b}m$($env:USERNAME)@$($env:COMPUTERNAME)${esc}[39m $($originalText -join '')"
}
# Input is marked busy by the PTY bridge. User PSReadLine key bindings are retained.
