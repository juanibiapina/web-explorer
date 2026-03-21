{ pkgs ? import <nixpkgs> {} }:

let
  # Build a CA certificate directory with hash-based symlinks that
  # workerd's BoringSSL can use. NixOS doesn't ship individual cert files
  # with hash names, but BoringSSL needs them for verification.
  certDir = pkgs.runCommand "workerd-certs" { buildInputs = [ pkgs.openssl ]; } ''
    mkdir -p $out
    cd $out

    # Split the nix CA bundle into individual PEM files
    awk 'BEGIN {n=0} /-----BEGIN CERTIFICATE-----/ {n++; fname=sprintf("cert-%03d.pem", n)} fname {print > fname}' \
      ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt

    # Create hash-based symlinks for each cert
    for f in cert-*.pem; do
      hash=$(openssl x509 -hash -noout -in "$f" 2>/dev/null) || continue
      i=0
      while [ -e "''${hash}.''${i}" ]; do i=$((i + 1)); done
      ln -s "$f" "''${hash}.''${i}"
    done
  '';
in

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs
    pkgs.nodePackages.pnpm
    pkgs.nodePackages.wrangler
  ];

  # Tell workerd (BoringSSL) where to find CA certificates.
  SSL_CERT_DIR = "${certDir}";

  # Patch the npm-installed workerd binary. It ships as a dynamically linked
  # ELF binary that can't run on NixOS. We replace it with a symlink to the
  # workerd bundled in the nix-packaged wrangler.
  shellHook = ''
    _nix_workerd=$(find ${pkgs.nodePackages.wrangler}/lib -path "*/workerd-linux-64/bin/workerd" -type f 2>/dev/null | head -1)

    if [ -n "$_nix_workerd" ] && [ -d node_modules ]; then
      _patched=0
      for broken in $(find node_modules -path "*/workerd-linux-64/bin/workerd" ! -type l 2>/dev/null); do
        if ! "$broken" --version >/dev/null 2>&1; then
          ln -sf "$_nix_workerd" "$broken"
          _patched=$((_patched + 1))
        fi
      done
      if [ "$_patched" -gt 0 ]; then
        echo "Patched $_patched workerd binary(ies) for NixOS"
      fi
    fi
  '';
}
