// === AUDIO SPECTRUM VISUALIZER FOR OBS ===
const config = {
    // --- Visualizer Settings ---
    fftSize: 1024, // (32 - 32768, power of 2)
    smoothing: 0.3, // Reduced smoothing for more dynamic movement

    // --- Dot-based spectrum bars (optimized for 1080px height) ---
    dotSize: 16, // Size of each square dot (made even thicker for better visibility)
    dotGap: 4, // Gap between dots within a bar (increased for better separation)
    dotsPerBar: 10, // Number of dots per bar (horizontal)
    barHeight: 20, // Height of each frequency bar
    barGap: 4, // Gap between frequency bars (vertical)
    spectrumHeightScale: 0.2, // Extremely low - prevent max sticking

    // --- Stereo mode settings ---
    stereoMode: true, // Enable stereo L/R channel separation

    // Rainbow color system
    rainbowBaseHue: 0, // Starting hue for rainbow (0 = red)
    rainbowRange: 360, // Full rainbow range
    minSaturation: 70, // Minimum saturation for vibrant colors
    maxSaturation: 100, // Maximum saturation for vibrant colors
    minLightness: 15, // Very dimmed dots for better contrast
    maxLightness: 85, // Very bright dots for better visibility

    // --- Stereo color themes ---
    leftChannelHueOffset: 0, // Left channel hue offset (0 = red/warm)
    rightChannelHueOffset: 180, // Right channel hue offset (180 = cyan/cool)
    
    // --- Transparency settings ---
    unlitDotOpacity: 0.5, // Opacity for unlit dots (0.0 = invisible, 1.0 = opaque)
};
// --- END SETTINGS ---

const canvas = document.getElementById('canvas');
const gl =
    canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    console.log('WebGL not supported, falling back to 2D Canvas');
}

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// WebGL setup
if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0); // Transparent background
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Simple vertex shader
    const vertexShaderSource = `
        attribute vec2 a_position;
        attribute vec4 a_color;
        varying vec4 v_color;
        uniform vec2 u_resolution;
        
        void main() {
            vec2 position = ((a_position / u_resolution) * 2.0) - 1.0;
            gl_Position = vec4(position * vec2(1, -1), 0, 1);
            v_color = a_color;
        }
    `;

    // Simple fragment shader
    const fragmentShaderSource = `
        precision mediump float;
        varying vec4 v_color;
        
        void main() {
            gl_FragColor = v_color;
        }
    `;

    // Compile shader
    function createShader(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
    }

    // Create program
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(
        gl,
        gl.FRAGMENT_SHADER,
        fragmentShaderSource,
    );

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Get locations
    window.positionLocation = gl.getAttribLocation(program, 'a_position');
    window.colorLocation = gl.getAttribLocation(program, 'a_color');
    window.resolutionLocation = gl.getUniformLocation(program, 'u_resolution');

    gl.uniform2f(window.resolutionLocation, canvas.width, canvas.height);
}

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

// Stereo setup - dual analyzers for L/R channels
const leftAnalyser = audioContext.createAnalyser();
const rightAnalyser = audioContext.createAnalyser();
leftAnalyser.fftSize = config.fftSize;
rightAnalyser.fftSize = config.fftSize;
leftAnalyser.smoothingTimeConstant = config.smoothing;
rightAnalyser.smoothingTimeConstant = config.smoothing;

const bufferLength = leftAnalyser.frequencyBinCount;
const leftDataArray = new Uint8Array(bufferLength);
const rightDataArray = new Uint8Array(bufferLength);
const leftSmoothedDataArray = new Float32Array(bufferLength);
const rightSmoothedDataArray = new Float32Array(bufferLength);

// Legacy mono support
const analyser = leftAnalyser; // Fallback for mono mode
const dataArray = leftDataArray;
const smoothedDataArray = leftSmoothedDataArray;

async function setupAudioContext() {
    try {
        console.log('デスクトップ音声またはマイクへのアクセスを要求中...');

        // まずデスクトップ音声（画面共有）を試行
        let stream;
        try {
            console.log('デスクトップ音声の取得を試行中...');
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: false,
                audio: {
                    channelCount: config.stereoMode ? 2 : 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000,
                }
            });
            console.log('デスクトップ音声の取得に成功！');
            console.log('選択されたデバイス:', stream.getAudioTracks()[0].label);
        } catch (desktopError) {
            console.log('デスクトップ音声が利用できません。マイクを試行中...');
            
            // デスクトップ音声が失敗した場合、マイクにフォールバック
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: config.stereoMode ? 2 : 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });
            console.log('マイクアクセスが許可されました！');
            console.log('選択されたデバイス:', stream.getAudioTracks()[0].label);
        }

        const source = audioContext.createMediaStreamSource(stream);
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0; // Normal signal level

        if (
            config.stereoMode &&
            stream.getAudioTracks()[0].getSettings().channelCount === 2
        ) {
            // Stereo mode - split channels
            console.log('Setting up stereo mode with L/R channel separation');
            const splitter = audioContext.createChannelSplitter(2);

            source.connect(gainNode);
            gainNode.connect(splitter);

            // Connect left and right channels to separate analyzers
            splitter.connect(leftAnalyser, 0); // Left channel (index 0)
            splitter.connect(rightAnalyser, 1); // Right channel (index 1)

            console.log('Stereo audio processing enabled!');
        } else {
            // Mono mode - use left analyzer only
            console.log('Using mono mode (stereo not available or disabled)');
            source.connect(gainNode);
            gainNode.connect(leftAnalyser);
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        console.log('音声コンテキストが正常にセットアップされました！リアルタイム音声データを使用中');
        draw();
    } catch (audioError) {
        console.error('音声アクセスに失敗:', audioError);
        
        // より詳細なエラーメッセージとソリューションを提供
        let errorMessage = 'オーディオビジュアライザーの音声キャプチャに失敗しました。\n\n';
        errorMessage += '【VR配信での推奨設定】\n';
        errorMessage += '1. OBSで「アプリケーション音声キャプチャ」を設定\n';
        errorMessage += '2. このブラウザソースで「デスクトップ音声を共有」を選択\n';
        errorMessage += '3. Virtual Desktop側のマイク設定は無効のままでOK\n\n';
        errorMessage += '【対処法】\n';
        errorMessage += '• ページをリロードして再度音声共有を許可\n';
        errorMessage += '• ブラウザの音声アクセス権限を確認\n';
        errorMessage += '• OBSのアプリケーション音声キャプチャが有効か確認\n\n';
        errorMessage += 'エラー詳細: ' + audioError.message;
        
        alert(errorMessage);
        
        // デモ用のダミーデータでビジュアライザーを動作させる
        console.log('デモモードで起動中...');
        startDemoMode();
    }
}

function draw() {
    requestAnimationFrame(draw);

    // Get real audio data from both analyzers
    leftAnalyser.getByteFrequencyData(leftDataArray);
    if (config.stereoMode) {
        rightAnalyser.getByteFrequencyData(rightDataArray);
    } else {
        // Copy left to right for mono mode
        rightDataArray.set(leftDataArray);
    }

    // Dynamic movement with quick response for both channels
    const smoothingFactor = 0.4; // Reduced smoothing for more aggressive movement

    // Process left channel
    for (let i = 0; i < leftDataArray.length; i++) {
        const currentSmoothed = leftSmoothedDataArray[i];
        const rawValue = leftDataArray[i];

        if (rawValue > currentSmoothed) {
            leftSmoothedDataArray[i] =
                currentSmoothed * smoothingFactor +
                rawValue * (1 - smoothingFactor);
        } else {
            leftSmoothedDataArray[i] =
                currentSmoothed * (smoothingFactor * 0.6) +
                rawValue * (1 - smoothingFactor * 0.6);
        }
    }

    // Process right channel
    for (let i = 0; i < rightDataArray.length; i++) {
        const currentSmoothed = rightSmoothedDataArray[i];
        const rawValue = rightDataArray[i];

        if (rawValue > currentSmoothed) {
            rightSmoothedDataArray[i] =
                currentSmoothed * smoothingFactor +
                rawValue * (1 - smoothingFactor);
        } else {
            rightSmoothedDataArray[i] =
                currentSmoothed * (smoothingFactor * 0.6) +
                rawValue * (1 - smoothingFactor * 0.6);
        }
    }

    // Legacy compatibility for mono fallback
    dataArray.set(leftDataArray);
    smoothedDataArray.set(leftSmoothedDataArray);

    // Call the visualization rendering
    renderVisualization();
}

// 分離された描画ロジック（通常モードとデモモードで共有）
function renderVisualization() {
    if (gl) {
        // WebGL rendering (GPU accelerated)
        gl.clear(gl.COLOR_BUFFER_BIT);

        // --- Dot-based Spectrum Bars on Left and Right Edges (WebGL) ---
        const dotSize = config.dotSize;
        const dotGap = config.dotGap;
        const dotsPerBar = config.dotsPerBar;
        const barHeight = config.barHeight;
        const barGap = config.barGap;

        // Calculate how many frequency bars fit vertically
        const maxBars = Math.floor(canvas.height / (barHeight + barGap));
        const numBars = Math.min(
            maxBars,
            Math.floor(smoothedDataArray.length / 2),
        );
        const spectrumWidthScale = config.spectrumHeightScale * 0.5;

        const vertices = [];
        const colors = [];

        // Render both left and right channels
        for (
            let channel = 0;
            channel < (config.stereoMode ? 2 : 1);
            channel++
        ) {
            const channelData =
                channel === 0 ? leftSmoothedDataArray : rightSmoothedDataArray;
            const hueOffset =
                channel === 0
                    ? config.leftChannelHueOffset
                    : config.rightChannelHueOffset;

            for (let i = 0; i < numBars; i++) {
                // Optimized frequency mapping for better high-frequency visibility
                const minFreqBin = 2; // Start from ~90Hz
                const maxFreqBin = Math.min(200, channelData.length - 1); // Up to ~9.4kHz (more focused range)
                const frequencyRange = maxFreqBin - minFreqBin;

                // Gentler logarithmic curve + high frequency boost
                const logIndex = Math.pow(i / (numBars - 1), 0.8); // Gentler curve
                const frequencyIndex = Math.floor(
                    minFreqBin + logIndex * frequencyRange,
                );

                // Get raw audio level (0-255)
                let audioLevel = channelData[frequencyIndex];

                // Apply gentle high frequency boost for visibility
                const highFreqBoost = 1 + (i / numBars) * 0.2; // Very gentle 1x to 1.2x
                audioLevel *= highFreqBoost;

                // Direct level-to-dots mapping with much higher thresholds
                let litDots = 0;

                // Create distinct frequency characteristics
                // i = 0 (bottom) = low freq, i = numBars-1 (top) = high freq
                const freqPosition = i / (numBars - 1); // 0 = low freq, 1 = high freq

                let thresholds;
                if (freqPosition < 0.3) {
                    // LOW FREQUENCIES (Bass/Drums) - Bottom 30% of screen
                    // More accessible thresholds for powerful bass moments
                    thresholds = [
                        20, 45, 80, 125, 180, 245, 320, 405, 500, 610,
                    ];
                } else if (freqPosition < 0.7) {
                    // MID FREQUENCIES (Vocals/Instruments) - Middle 40% of screen
                    // Balanced and more reachable thresholds
                    thresholds = [15, 35, 60, 90, 130, 180, 240, 310, 390, 480];
                } else {
                    // HIGH FREQUENCIES (Cymbals/Treble) - Top 30% of screen
                    // Very sensitive with achievable maximum
                    thresholds = [10, 22, 38, 58, 85, 120, 165, 220, 285, 360];
                }

                // Count how many thresholds the audio level exceeds with soft transitions
                for (let t = 0; t < thresholds.length; t++) {
                    if (audioLevel >= thresholds[t]) {
                        litDots = t + 1;
                    } else {
                        // Add soft transition zone - if close to threshold, occasionally light up
                        const threshold = thresholds[t];
                        const softZone = threshold * 0.15; // 15% soft zone
                        if (audioLevel >= threshold - softZone) {
                            const probability =
                                (audioLevel - (threshold - softZone)) /
                                softZone;
                            if (Math.random() < probability * 0.3) {
                                // 30% max probability in soft zone
                                litDots = t + 1;
                            }
                        }
                        break;
                    }
                }

                // Calculate Y position for this frequency bar
                const yPosition =
                    canvas.height - (i + 1) * (barHeight + barGap);

                // Get rainbow color for this bar with channel hue offset
                const rainbowColor = getRainbowColor(
                    i,
                    numBars,
                    litDots,
                    dotsPerBar,
                    hueOffset,
                );

                // Draw dots for this frequency bar
                for (let dotIndex = 0; dotIndex < dotsPerBar; dotIndex++) {
                    const isLit = dotIndex < litDots;

                    // Dynamic rainbow color calculation based on dot position and activity
                    let finalColor;
                    if (isLit) {
                        // Lit dots: use full rainbow color with activity-based intensity
                        const dotIntensity = (dotIndex + 1) / litDots; // Gradient within lit dots
                        const adjustedLightness =
                            rainbowColor.lightness * (0.6 + 0.4 * dotIntensity);
                        finalColor = {
                            hue: rainbowColor.hue,
                            saturation: rainbowColor.saturation,
                            lightness: Math.min(
                                adjustedLightness,
                                config.maxLightness,
                            ),
                            alpha: 1.0, // Fully opaque for lit dots
                        };
                    } else {
                        // Unlit dots: very dim version of the rainbow color with transparency
                        finalColor = {
                            hue: rainbowColor.hue,
                            saturation: rainbowColor.saturation * 0.3,
                            lightness: config.minLightness * 0.3,
                            alpha: config.unlitDotOpacity, // Semi-transparent for unlit dots
                        };
                    }

                    const rgb = hslToRgb(
                        finalColor.hue / 360,
                        finalColor.saturation / 100,
                        finalColor.lightness / 100,
                    );
                    
                    // Add alpha channel to RGB
                    const rgba = {
                        r: rgb.r,
                        g: rgb.g,
                        b: rgb.b,
                        a: finalColor.alpha,
                    };

                    // Calculate dot position based on channel
                    let dotX;
                    if (config.stereoMode && channel === 1) {
                        // Right channel - position from right edge, dots grow leftward
                        dotX =
                            canvas.width -
                            10 -
                            (dotIndex + 1) * (dotSize + dotGap);
                    } else {
                        // Left channel - position from left edge, dots grow rightward
                        dotX = 10 + dotIndex * (dotSize + dotGap);
                    }

                    // Square dot vertices (2 triangles = 6 vertices)
                    vertices.push(
                        dotX,
                        yPosition, // top-left
                        dotX + dotSize,
                        yPosition, // top-right
                        dotX,
                        yPosition + barHeight, // bottom-left
                        dotX + dotSize,
                        yPosition, // top-right
                        dotX + dotSize,
                        yPosition + barHeight, // bottom-right
                        dotX,
                        yPosition + barHeight, // bottom-left
                    );

                    // Colors for single square (6 vertices, 4 components each - RGBA)
                    for (let j = 0; j < 6; j++) {
                        colors.push(rgba.r, rgba.g, rgba.b, rgba.a);
                    }
                }
            }
        }

        // Create and bind buffers
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(vertices),
            gl.DYNAMIC_DRAW,
        );
        gl.enableVertexAttribArray(window.positionLocation);
        gl.vertexAttribPointer(
            window.positionLocation,
            2,
            gl.FLOAT,
            false,
            0,
            0,
        );

        const colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(colors),
            gl.DYNAMIC_DRAW,
        );
        gl.enableVertexAttribArray(window.colorLocation);
        gl.vertexAttribPointer(window.colorLocation, 4, gl.FLOAT, false, 0, 0);

        // Draw
        if (vertices.length > 0) {
            gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
        }
    } else {
        // Fallback to 2D Canvas if WebGL fails
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Dot-based 2D spectrum bars
            const dotSize = config.dotSize;
            const dotGap = config.dotGap;
            const dotsPerBar = config.dotsPerBar;
            const barHeight = config.barHeight;
            const barGap = config.barGap;

            // Calculate how many frequency bars fit vertically
            const maxBars = Math.floor(canvas.height / (barHeight + barGap));
            const numBars = Math.min(
                maxBars,
                Math.floor(smoothedDataArray.length / 2),
            );
            const spectrumWidthScale = config.spectrumHeightScale * 0.5;

            // Render both left and right channels
            for (
                let channel = 0;
                channel < (config.stereoMode ? 2 : 1);
                channel++
            ) {
                const channelData =
                    channel === 0
                        ? leftSmoothedDataArray
                        : rightSmoothedDataArray;
                const hueOffset =
                    channel === 0
                        ? config.leftChannelHueOffset
                        : config.rightChannelHueOffset;

                for (let i = 0; i < numBars; i++) {
                    // Optimized frequency mapping for better high-frequency visibility
                    const minFreqBin = 2; // Start from ~90Hz
                    const maxFreqBin = Math.min(200, channelData.length - 1); // Up to ~9.4kHz (more focused range)
                    const frequencyRange = maxFreqBin - minFreqBin;

                    // Gentler logarithmic curve + high frequency boost
                    const logIndex = Math.pow(i / (numBars - 1), 0.8); // Gentler curve
                    const frequencyIndex = Math.floor(
                        minFreqBin + logIndex * frequencyRange,
                    );

                    // Get raw audio level (0-255)
                    let audioLevel = channelData[frequencyIndex];

                    // Apply gentle high frequency boost for visibility
                    const highFreqBoost = 1 + (i / numBars) * 0.2; // Very gentle 1x to 1.2x
                    audioLevel *= highFreqBoost;

                    // Direct level-to-dots mapping with much higher thresholds
                    let litDots = 0;

                    // Create distinct frequency characteristics
                    // i = 0 (bottom) = low freq, i = numBars-1 (top) = high freq
                    const freqPosition = i / (numBars - 1); // 0 = low freq, 1 = high freq

                    let thresholds;
                    if (freqPosition < 0.3) {
                        // LOW FREQUENCIES (Bass/Drums) - Bottom 30% of screen
                        // More accessible thresholds for powerful bass moments
                        thresholds = [
                            20, 45, 80, 125, 180, 245, 320, 405, 500, 610,
                        ];
                    } else if (freqPosition < 0.7) {
                        // MID FREQUENCIES (Vocals/Instruments) - Middle 40% of screen
                        // Balanced and more reachable thresholds
                        thresholds = [
                            15, 35, 60, 90, 130, 180, 240, 310, 390, 480,
                        ];
                    } else {
                        // HIGH FREQUENCIES (Cymbals/Treble) - Top 30% of screen
                        // Very sensitive with achievable maximum
                        thresholds = [
                            10, 22, 38, 58, 85, 120, 165, 220, 285, 360,
                        ];
                    }

                    // Count how many thresholds the audio level exceeds with soft transitions
                    for (let t = 0; t < thresholds.length; t++) {
                        if (audioLevel >= thresholds[t]) {
                            litDots = t + 1;
                        } else {
                            // Add soft transition zone - if close to threshold, occasionally light up
                            const threshold = thresholds[t];
                            const softZone = threshold * 0.15; // 15% soft zone
                            if (audioLevel >= threshold - softZone) {
                                const probability =
                                    (audioLevel - (threshold - softZone)) /
                                    softZone;
                                if (Math.random() < probability * 0.3) {
                                    // 30% max probability in soft zone
                                    litDots = t + 1;
                                }
                            }
                            break;
                        }
                    }

                    // Calculate Y position for this frequency bar
                    const yPosition =
                        canvas.height - (i + 1) * (barHeight + barGap);

                    // Get rainbow color for this bar with channel hue offset
                    const rainbowColor = getRainbowColor(
                        i,
                        numBars,
                        litDots,
                        dotsPerBar,
                        hueOffset,
                    );

                    // Draw dots for this frequency bar
                    for (let dotIndex = 0; dotIndex < dotsPerBar; dotIndex++) {
                        const isLit = dotIndex < litDots;

                        // Dynamic rainbow color calculation based on dot position and activity
                        let finalColor;
                        if (isLit) {
                            // Lit dots: use full rainbow color with activity-based intensity
                            const dotIntensity = (dotIndex + 1) / litDots; // Gradient within lit dots
                            const adjustedLightness =
                                rainbowColor.lightness *
                                (0.6 + 0.4 * dotIntensity);
                            finalColor = {
                                hue: rainbowColor.hue,
                                saturation: rainbowColor.saturation,
                                lightness: Math.min(
                                    adjustedLightness,
                                    config.maxLightness,
                                ),
                                alpha: 1.0, // Fully opaque for lit dots
                            };
                        } else {
                            // Unlit dots: very dim version of the rainbow color with transparency
                            finalColor = {
                                hue: rainbowColor.hue,
                                saturation: rainbowColor.saturation * 0.3,
                                lightness: config.minLightness * 0.3,
                                alpha: config.unlitDotOpacity, // Semi-transparent for unlit dots
                            };
                        }

                        ctx.fillStyle = `hsla(${finalColor.hue}, ${finalColor.saturation}%, ${finalColor.lightness}%, ${finalColor.alpha})`;

                        // Calculate dot position based on channel
                        let dotX;
                        if (config.stereoMode && channel === 1) {
                            // Right channel - position from right edge, dots grow leftward
                            dotX =
                                canvas.width -
                                10 -
                                (dotIndex + 1) * (dotSize + dotGap);
                        } else {
                            // Left channel - position from left edge, dots grow rightward
                            dotX = 10 + dotIndex * (dotSize + dotGap);
                        }

                        // Draw square dot
                        ctx.fillRect(dotX, yPosition, dotSize, barHeight);
                    }
                }
            }
        }
    }
}

// Rainbow color calculation based on frequency position and dot activity
function getRainbowColor(barIndex, numBars, litDots, maxDots, hueOffset = 0) {
    // Base hue from frequency position (red -> violet across spectrum)
    const freqHue = (barIndex / (numBars - 1)) * config.rainbowRange;

    // Dynamic hue shift based on dot activity (more active = more colorful shift)
    const activityShift = (litDots / maxDots) * 60; // Up to 60° shift when fully active

    // Final hue with activity-based variation and channel offset
    const finalHue =
        (config.rainbowBaseHue + freqHue + activityShift + hueOffset) % 360;

    // Saturation increases with activity (more dots = more vibrant)
    const saturation =
        config.minSaturation +
        (litDots / maxDots) * (config.maxSaturation - config.minSaturation);

    // Lightness based on whether dot is lit
    const lightness =
        litDots > 0
            ? config.minLightness +
              (litDots / maxDots) * (config.maxLightness - config.minLightness)
            : config.minLightness * 0.3; // Very dim when no dots lit

    return { hue: finalHue, saturation: saturation, lightness: lightness };
}

// HSL to RGB conversion for WebGL
function hslToRgb(h, s, l) {
    let r, g, b;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }

    return { r: r, g: g, b: b };
}

// デモモード用の関数
function startDemoMode() {
    console.log('デモモードでビジュアライザーを開始します');
    
    // ダミーの音声データを生成してビジュアライザーを動作させる
    function generateDemoData() {
        const time = Date.now() * 0.001; // 時間ベースのアニメーション
        
        // 左チャンネルのダミーデータ
        for (let i = 0; i < leftDataArray.length; i++) {
            const frequency = i / leftDataArray.length;
            const wave1 = Math.sin(time * 2 + frequency * 10) * 127 + 128;
            const wave2 = Math.sin(time * 3 + frequency * 15) * 64 + 64;
            const wave3 = Math.sin(time * 1.5 + frequency * 8) * 32 + 32;
            leftDataArray[i] = Math.max(0, Math.min(255, wave1 + wave2 + wave3));
        }
        
        // 右チャンネルのダミーデータ（位相をずらして立体感を演出）
        for (let i = 0; i < rightDataArray.length; i++) {
            const frequency = i / rightDataArray.length;
            const wave1 = Math.sin(time * 2.2 + frequency * 12 + Math.PI * 0.3) * 127 + 128;
            const wave2 = Math.sin(time * 2.8 + frequency * 18 + Math.PI * 0.5) * 64 + 64;
            const wave3 = Math.sin(time * 1.8 + frequency * 9 + Math.PI * 0.7) * 32 + 32;
            rightDataArray[i] = Math.max(0, Math.min(255, wave1 + wave2 + wave3));
        }
    }
    
    // デモモード用の描画ループ
    function drawDemo() {
        requestAnimationFrame(drawDemo);
        generateDemoData();
        
        // 通常の描画処理と同じスムージング処理を適用
        const smoothingFactor = 0.4;
        
        for (let i = 0; i < leftDataArray.length; i++) {
            const currentSmoothed = leftSmoothedDataArray[i] || 0;
            const rawValue = leftDataArray[i];
            
            if (rawValue > currentSmoothed) {
                leftSmoothedDataArray[i] = currentSmoothed * smoothingFactor + rawValue * (1 - smoothingFactor);
            } else {
                leftSmoothedDataArray[i] = currentSmoothed * (smoothingFactor * 0.6) + rawValue * (1 - smoothingFactor * 0.6);
            }
        }
        
        for (let i = 0; i < rightDataArray.length; i++) {
            const currentSmoothed = rightSmoothedDataArray[i] || 0;
            const rawValue = rightDataArray[i];
            
            if (rawValue > currentSmoothed) {
                rightSmoothedDataArray[i] = currentSmoothed * smoothingFactor + rawValue * (1 - smoothingFactor);
            } else {
                rightSmoothedDataArray[i] = currentSmoothed * (smoothingFactor * 0.6) + rawValue * (1 - smoothingFactor * 0.6);
            }
        }
        
        // 通常の描画処理を呼び出し（draw関数の中身と同じ描画ロジック）
        renderVisualization();
    }
    
    drawDemo();
}

// UI制御用の関数群
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

function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function updateButtonStates(activeButton) {
    const buttons = ['desktop-audio-btn', 'microphone-btn', 'demo-btn'];
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

async function switchToDesktopAudio() {
    if (isRunning) {
        stopCurrentAudio();
    }
    
    updateStatus('システム音声に接続中...');
    updateButtonStates('desktop-audio-btn');
    
    try {
        // まず利用可能な音声デバイスを列挙
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        console.log('利用可能な音声入力デバイス:', audioInputs);
        
        // ステレオミックスやVoiceMeeterなどの仮想デバイスを探す
        const virtualDevices = audioInputs.filter(device => 
            device.label.toLowerCase().includes('stereo mix') ||
            device.label.toLowerCase().includes('voicemeeter') ||
            device.label.toLowerCase().includes('virtual') ||
            device.label.toLowerCase().includes('cable') ||
            device.label.toLowerCase().includes('mix')
        );
        
        let stream;
        
        if (virtualDevices.length > 0) {
            // 仮想デバイスが見つかった場合
            console.log('仮想音声デバイスを発見:', virtualDevices[0].label);
            stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: virtualDevices[0].deviceId,
                    channelCount: config.stereoMode ? 2 : 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            });
            updateStatus(`🔊 ${virtualDevices[0].label} で動作中`);
        } else {
            // 仮想デバイスがない場合、画面共有を試行
            console.log('仮想デバイスが見つからないため、画面共有を試行');
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    mediaSource: 'screen',
                    width: { ideal: 1 },
                    height: { ideal: 1 },
                    frameRate: { ideal: 1 }
                },
                audio: {
                    channelCount: config.stereoMode ? 2 : 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    sampleRate: 48000,
                }
            });
            updateStatus('🖥️ 画面音声で動作中');
        }
        
        connectAudioStream(stream);
        currentAudioSource = 'desktop';
    } catch (error) {
        console.error('システム音声の取得に失敗:', error);
        updateStatus('❌ システム音声の取得に失敗 - マイクを試行中...');
        
        // システム音声が失敗した場合、自動的にマイクにフォールバック
        setTimeout(() => {
            switchToMicrophone();
        }, 1000);
    }
}

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

function switchToDemo() {
    if (isRunning) {
        stopCurrentAudio();
    }
    
    updateStatus('✨ デモモードで動作中');
    updateButtonStates('demo-btn');
    currentAudioSource = 'demo';
    startDemoMode();
}

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

function stopCurrentAudio() {
    if (currentAudioSource && typeof currentAudioSource === 'object' && currentAudioSource.getTracks) {
        currentAudioSource.getTracks().forEach(track => track.stop());
    }
    isRunning = false;
}

// デバイス選択機能
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
        
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            
            let label = device.label || `音声デバイス ${device.deviceId.slice(0, 8)}`;
            
            // 仮想デバイスを識別
            if (label.toLowerCase().includes('stereo mix') ||
                label.toLowerCase().includes('voicemeeter') ||
                label.toLowerCase().includes('virtual') ||
                label.toLowerCase().includes('cable')) {
                label = `🔊 ${label} (推奨)`;
            } else if (label.toLowerCase().includes('microphone') ||
                       label.toLowerCase().includes('マイク')) {
                label = `🎤 ${label}`;
            } else {
                label = `🔉 ${label}`;
            }
            
            option.textContent = label;
            select.appendChild(option);
        });
        
        console.log(`${audioInputs.length}個の音声入力デバイスを発見`);
    } catch (error) {
        console.error('音声デバイスの列挙に失敗:', error);
    }
}

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

// Initialize the visualizer
document.addEventListener('DOMContentLoaded', async () => {
    // 初期化時は設定パネルを表示
    settingsVisible = true;
    const controls = document.getElementById('audio-controls');
    if (controls) {
        controls.style.display = 'block';
    }
    
    updateStatus('音声デバイスを検索中...');
    
    // 音声デバイスを列挙
    await populateAudioDevices();
    
    updateStatus('準備完了 - 音声ソースを選択してください');
    
    // 自動的にシステム音声を試行
    switchToDesktopAudio();
    
    // 5秒後に設定パネルを自動で閉じる
    setTimeout(() => {
        if (settingsVisible) {
            toggleSettings();
        }
    }, 5000);
});

// Handle window resize
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (gl) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(window.resolutionLocation, canvas.width, canvas.height);
    }
});
