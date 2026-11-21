{
  pkgs,
  nodejs,
  lint,
  system,
  npmLibrary,
}:
let
  unit = pkgs.buildNpmPackage {
    pname = "resources-unit-js";
    version = "0.1.0";
    inherit
      nodejs
      ;
    src = npmLibrary.src;
    inherit (npmLibrary.npmDependencies) npmDeps npmConfigHook;
    dontNpmBuild = true;
    doCheck = true;
    checkPhase = ''
      runHook preCheck
      npm run build
      npm run typecheck
      npm test -- --prebuilt
      runHook postCheck
    '';
    installPhase = ''
      mkdir -p "$out"
      cat > "$out/report.json" <<EOF
      {"schemaVersion":1,"name":"unit-js","kind":"unit","status":"passed","system":"${system}","summary":"TypeScript and Vitest checks passed","artifacts":{}}
      EOF
    '';
  };
  lintCheck = lint.mkCheck {
    src = npmLibrary.src;
    name = "resources-lint";
    npmDependencies = npmLibrary.npmDependencies // {
      inherit nodejs;
    };
  };
in
{
  unit-js = unit;
  lint = lintCheck;
  default = pkgs.runCommand "resources-check-default" { } ''
    mkdir -p "$out/artifacts"
    ln -s ${unit} "$out/artifacts/unit-js"
    ln -s ${lintCheck} "$out/artifacts/lint"
    cat > "$out/report.json" <<EOF
    {"schemaVersion":1,"name":"default","kind":"aggregate","status":"passed","system":"${system}","summary":"Routine resources verification passed","artifacts":{"unit-js":"artifacts/unit-js/report.json","lint":"artifacts/lint/report.json"}}
    EOF
  '';
}
