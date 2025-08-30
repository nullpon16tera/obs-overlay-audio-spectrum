// === メインエントリーポイント ===
// ビジュアライザーとオーディオマネージャーの初期化

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎵 VR配信用オーディオビジュアライザーを起動中...');
    
    // 初期化時は設定パネルを表示
    settingsVisible = true;
    const controls = document.getElementById('audio-controls');
    if (controls) {
        controls.style.display = 'block';
    }
    
    // オーディオマネージャーの初期化
    await initializeAudioManager();
});
