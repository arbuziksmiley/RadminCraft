param(
    [Parameter(Mandatory = $true)]
    [string]$Jdk8,

    [Parameter(Mandatory = $true)]
    [string]$Jdk17
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$output = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $output -Force | Out-Null

function Invoke-BridgeBuild {
    param(
        [string]$MinecraftVersion,
        [string]$JavaHome,
        [string[]]$ExtraArguments = @()
    )

    $project = Join-Path $root "forge-$MinecraftVersion"
    $gradle = Join-Path $project 'gradlew.bat'
    $previousJavaHome = $env:JAVA_HOME
    $previousPath = $env:PATH
    try {
        $env:JAVA_HOME = $JavaHome
        $env:PATH = "$(Join-Path $JavaHome 'bin');$previousPath"
        Push-Location $project
        try {
            & $gradle build --no-daemon --console=plain @ExtraArguments
            if ($LASTEXITCODE -ne 0) {
                throw "Forge $MinecraftVersion build failed with exit code $LASTEXITCODE"
            }
        }
        finally {
            Pop-Location
        }
    }
    finally {
        $env:JAVA_HOME = $previousJavaHome
        $env:PATH = $previousPath
    }

    $source = Join-Path $project 'build\libs\radmincraft_bridge-1.1.0.jar'
    $destination = Join-Path $output "RadminCraft-Bridge-Forge-$MinecraftVersion-1.1.0.jar"
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

Invoke-BridgeBuild '1.12.2' $Jdk8
Invoke-BridgeBuild '1.16.5' $Jdk17 @(
    '-Porg.gradle.java.installations.auto-detect=false',
    "-Porg.gradle.java.installations.paths=$($Jdk8.Replace('\', '/'))"
)
Invoke-BridgeBuild '1.18.2' $Jdk17
Invoke-BridgeBuild '1.19.2' $Jdk17
Invoke-BridgeBuild '1.20.1' $Jdk17

Get-FileHash (Join-Path $output '*.jar') -Algorithm SHA256 |
    ForEach-Object { "$($_.Hash)  $(Split-Path $_.Path -Leaf)" } |
    Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ascii

Write-Host "RadminCraft Bridge builds are ready in $output"
