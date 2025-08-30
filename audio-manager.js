// === OBS接続用オーディオマネージャー ===
// VR配信でCABLE Outputを使用するための音声管理

// UI制御用の変数
let currentAudioSource = null;
let isRunning = false;
let settingsVisible = false;

// 設定パネルの開閉制御
function toggleSettings() {
    const controls = document.getElementById('audio-controls');
    const toggleBtn = document.getElementById('settings-toggle');
    
    if (!controls || !toggleBtn) return;
    
    settingsVisible = !settingsVisible;
    
    if (settingsVisible) {
        controls.style.display = 'block';
        toggleBtn.style.background = 'rgba(0,0,0,0.9)';
        toggleBtn.style.boxShadow = '0 0 10px rgba(255,255,255,0.3)';
    } else {
        controls.style.display = 'none';
        toggleBtn.style.background = 'rgba(0,0,0,0.7)';
        toggleBtn.style.boxShadow = 'none';
    }
}

// ステータス更新
function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

// ボタン状態更新
function updateButtonStates(activeButton) {
    const buttons = ['microphone-btn', 'demo-btn'];
    buttons.forEach(buttonId => {
        const btn = document.getElementById(buttonId);
        if (btn) {
            if (buttonId === activeButton) {
                btn.style.opacity = '1';
                btn.style.boxShadow = '0 0 10px rgba(255,255,255,0.5)';
            } else {
                btn.style.opacity = '0.6';
                btn.style.boxShadow = 'none';
            }
        }
    });
}

// マイクに切り替え
async function switchToMicrophone() {
    if (isRunning) {
        stopCurrentAudio();
    }
    
    updateStatus('マイクに接続中...');
    updateButtonStates('microphone-btn');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: config.stereoMode ? 2 : 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        
        connectAudioStream(stream);
        updateStatus('🎤 マイクで動作中');
        currentAudioSource = 'microphone';
    } catch (error) {
        console.error('マイクの取得に失敗:', error);
        updateStatus('❌ マイクの取得に失敗');
        updateButtonStates(null);
    }
}

// デモモードに切り替え
function switchToDemo() {
    if (isRunning) {
        stopCurrentAudio();
    }
    
    updateStatus('✨ デモモードで動作中');
    updateButtonStates('demo-btn');
    currentAudioSource = 'demo';
    startDemoMode();
}

// 音声ストリーム接続
function connectAudioStream(stream) {
    // 映像トラックがある場合は停止（音声のみ使用）
    const videoTracks = stream.getVideoTracks();
    videoTracks.forEach(track => {
        track.stop();
        stream.removeTrack(track);
    });
    
    // 音声トラックが存在するかチェック
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
        throw new Error('音声トラックが見つかりません');
    }
    
    console.log('音声トラック情報:', audioTracks[0].getSettings());
    
    const source = audioContext.createMediaStreamSource(stream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    if (
        config.stereoMode &&
        audioTracks[0].getSettings().channelCount === 2
    ) {
        console.log('ステレオモードでL/Rチャンネル分離を設定中');
        const splitter = audioContext.createChannelSplitter(2);

        source.connect(gainNode);
        gainNode.connect(splitter);

        splitter.connect(leftAnalyser, 0);
        splitter.connect(rightAnalyser, 1);
    } else {
        console.log('モノラルモードを使用中');
        source.connect(gainNode);
        gainNode.connect(leftAnalyser);
    }

    currentAudioSource = stream;
    isRunning = true;
    draw();
}

// 現在の音声を停止
function stopCurrentAudio() {
    if (currentAudioSource && typeof currentAudioSource === 'object' && currentAudioSource.getTracks) {
        currentAudioSource.getTracks().forEach(track => track.stop());
    }
    isRunning = false;
}

// 利用可能な音声デバイスを一覧表示
async function populateAudioDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        const select = document.getElementById('audio-device-select');
        if (!select) return;
        
        // 既存のオプションをクリア（最初のオプションは残す）
        while (select.children.length > 1) {
            select.removeChild(select.lastChild);
        }
        
        let cableOutputFound = false;
        let recommendedDeviceId = null;
        
        audioInputs.forEach(device => {
            let label = device.label || `音声デバイス ${device.deviceId.slice(0, 8)}`;
            
            // CABLE Outputのみを表示
            if (label.toLowerCase().includes('cable output') ||
                label.toLowerCase().includes('cable-output')) {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = `🎵 ${label}`;
                select.appendChild(option);
                
                cableOutputFound = true;
                recommendedDeviceId = device.deviceId;
            }
        });
        
        // CABLE Outputが見つからない場合のメッセージ
        if (!cableOutputFound) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '❌ CABLE Output が見つかりません';
            option.disabled = true;
            select.appendChild(option);
        }
        
        // CABLE Outputが見つかった場合の特別メッセージ
        if (cableOutputFound) {
            updateStatus('🎵 CABLE Output発見！手動で選択してください');
            
            // 推奨デバイスを目立たせる
            setTimeout(() => {
                if (settingsVisible || !isRunning) {
                    updateStatus('💡 音声デバイス選択で「CABLE Output」を選んでね！');
                }
            }, 2000);
        }
        
        console.log(`${audioInputs.length}個の音声入力デバイスを発見`);
    } catch (error) {
        console.error('音声デバイスの列挙に失敗:', error);
    }
}

// 選択されたデバイスに切り替え
async function switchToSelectedDevice() {
    const select = document.getElementById('audio-device-select');
    if (!select || !select.value) return;
    
    if (isRunning) {
        stopCurrentAudio();
    }
    
    const deviceId = select.value;
    const deviceLabel = select.options[select.selectedIndex].text;
    
    updateStatus(`${deviceLabel} に接続中...`);
    updateButtonStates(null); // すべてのボタンを非アクティブに
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: deviceId,
                channelCount: config.stereoMode ? 2 : 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            }
        });
        
        connectAudioStream(stream);
        updateStatus(`${deviceLabel} で動作中`);
        currentAudioSource = 'selected';
    } catch (error) {
        console.error('選択したデバイスの接続に失敗:', error);
        updateStatus(`❌ ${deviceLabel} の接続に失敗`);
        select.selectedIndex = 0; // 選択をリセット
    }
}

// 初期化処理
async function initializeAudioManager() {
    updateStatus('音声デバイスを検索中...');
    
    // 音声デバイスを列挙
    await populateAudioDevices();
    
    updateStatus('準備完了 - 音声ソースを選択してください');
    
    // CABLE Outputがあるかチェックして、あれば優先的に試行
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    const cableOutput = audioInputs.find(device => 
        device.label.toLowerCase().includes('cable output') ||
        device.label.toLowerCase().includes('cable-output')
    );
    
    if (cableOutput) {
        updateStatus('🎵 CABLE Output発見！自動接続を試行中...');
        
        // CABLE Outputを自動選択
        const select = document.getElementById('audio-device-select');
        if (select) {
            // セレクトボックスで該当デバイスを選択
            for (let i = 0; i < select.options.length; i++) {
                if (select.options[i].value === cableOutput.deviceId) {
                    select.selectedIndex = i;
                    break;
                }
            }
            
            // 自動接続を試行
            setTimeout(() => {
                switchToSelectedDevice();
            }, 500);
        }
    } else {
        // CABLE Outputがない場合は警告を表示
        updateStatus('⚠️ CABLE Output が見つかりません - VB-CABLEを確認してください');
    }
    
    // 5秒後に設定パネルを自動で閉じる
    setTimeout(() => {
        if (settingsVisible) {
            toggleSettings();
        }
    }, 5000);
}
