#ifndef SourceDir
  #error SourceDir must be supplied by the build script
#endif
#ifndef OutputDir
  #error OutputDir must be supplied by the build script
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{9F45E6F5-B9C0-4D73-A42F-6CD63E070D3B}
AppName=TuneCrate for DaVinci Resolve
AppVersion={#AppVersion}
AppPublisher=TuneCrate
DefaultDirName={commonappdata}\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\TuneCrate
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
Uninstallable=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=TuneCrate-windows-x64
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not DirExists(ExpandConstant('{commonpf}\Blackmagic Design\DaVinci Resolve')) then
    MsgBox('DaVinci Resolve was not detected. TuneCrate will still be installed, but Resolve Studio must be installed before you can use it.', mbInformation, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    MsgBox('TuneCrate is ready.' + #13#10 + #13#10 +
      'Restart DaVinci Resolve, then open:' + #13#10 +
      'Workspace > Workflow Integrations > TuneCrate', mbInformation, MB_OK);
end;
