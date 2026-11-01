fn main() {
    // tauri-build embeds icons/icon.ico in the exe resource but does not
    // watch it, so an icon change would otherwise keep the old one.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
