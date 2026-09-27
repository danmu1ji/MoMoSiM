use std::path::PathBuf;

fn main() {
    // `tauri.conf.json`의 frontendDist 경로가 없으면 generate_context! 가 panic 한다.
    // 프론트엔드 빌드(또는 편집기 실행) 전이라도 `cargo build/test`가 되도록 경로를 만들어 둔다.
    // 실제 실행/배포에서는 `beforeBuildCommand`가 빌드 결과로 이 디렉터리를 채운다.
    let dist = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../apps/desktop/dist");
    if !dist.exists() {
        let _ = std::fs::create_dir_all(&dist);
    }
    tauri_build::build();
}
