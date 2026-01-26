/**
 * WebGL Renderer for RTI/PTM visualization
 *
 * Implements real-time relighting using GPU shaders.
 * Supports multiple viewing modes: default, specular-only, and normal map.
 */

class RTIRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        this.ptmData = null;
        this.lightX = 0;
        this.lightY = 0;
        this.viewMode = 'default'; // 'default', 'specular', 'normals'
        this.specularEnhancement = 1.0;
        this.diffuseGain = 1.0;

        this.initShaders();
        this.initBuffers();
    }

    /**
     * Initialize WebGL shaders for PTM rendering
     */
    initShaders() {
        const gl = this.gl;

        // Vertex shader - simple pass-through
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;

            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment shader for PTM rendering
        const fragmentShaderSource = `
            precision mediump float;

            varying vec2 v_texCoord;

            // PTM coefficient textures (packed into RGB textures)
            uniform sampler2D u_coeffTex0; // a0, a1, a2
            uniform sampler2D u_coeffTex1; // a3, a4, a5
            uniform sampler2D u_rgbTex;    // Base RGB color
            uniform sampler2D u_normalTex; // Normal map

            uniform vec2 u_lightDir;       // Light direction (lu, lv)
            uniform int u_viewMode;        // 0=default, 1=specular, 2=normals
            uniform float u_specularEnhancement;
            uniform float u_diffuseGain;

            void main() {
                // Sample coefficient textures
                vec3 coeff012 = texture2D(u_coeffTex0, v_texCoord).rgb;
                vec3 coeff345 = texture2D(u_coeffTex1, v_texCoord).rgb;

                // Unpack coefficients (stored as 0-1, convert to -1 to 1 range for coefficients)
                float a0 = (coeff012.r - 0.5) * 4.0;
                float a1 = (coeff012.g - 0.5) * 4.0;
                float a2 = (coeff012.b - 0.5) * 4.0;
                float a3 = (coeff345.r - 0.5) * 4.0;
                float a4 = (coeff345.g - 0.5) * 4.0;
                float a5 = coeff345.b * 2.0;

                // Light direction components
                float lu = u_lightDir.x;
                float lv = u_lightDir.y;

                // Compute luminance using PTM polynomial
                // L = a0*lu² + a1*lv² + a2*lu*lv + a3*lu + a4*lv + a5
                float luminance = a0 * lu * lu +
                                  a1 * lv * lv +
                                  a2 * lu * lv +
                                  a3 * lu +
                                  a4 * lv +
                                  a5;

                // Compute a simple specular component
                // Using the normal direction (a3, a4 approximate the normal x, y)
                vec3 normal = texture2D(u_normalTex, v_texCoord).rgb * 2.0 - 1.0;

                // Light vector (lu, lv, sqrt(1 - lu² - lv²))
                float lz = sqrt(max(0.0, 1.0 - lu * lu - lv * lv));
                vec3 lightVec = normalize(vec3(lu, lv, lz));

                // View vector (looking straight at surface)
                vec3 viewVec = vec3(0.0, 0.0, 1.0);

                // Reflection vector for specular
                vec3 reflectVec = reflect(-lightVec, normal);
                float specular = pow(max(0.0, dot(reflectVec, viewVec)), 20.0);

                if (u_viewMode == 2) {
                    // Normal map visualization
                    gl_FragColor = vec4(normal * 0.5 + 0.5, 1.0);
                } else if (u_viewMode == 1) {
                    // Specular-only mode (grayscale specular highlight)
                    float spec = specular * u_specularEnhancement;

                    // Also include the PTM luminance variation
                    float ptmSpec = max(0.0, luminance - a5) * 2.0;
                    spec = max(spec, ptmSpec * u_specularEnhancement);

                    gl_FragColor = vec4(vec3(spec), 1.0);
                } else {
                    // Default mode - full color with relighting
                    vec3 baseColor = texture2D(u_rgbTex, v_texCoord).rgb;

                    // Apply PTM luminance modulation
                    luminance = clamp(luminance, 0.0, 2.0);
                    vec3 diffuse = baseColor * luminance * u_diffuseGain;

                    // Add specular highlight
                    vec3 specColor = vec3(1.0, 1.0, 0.95) * specular * u_specularEnhancement * 0.5;

                    vec3 finalColor = diffuse + specColor;
                    gl_FragColor = vec4(clamp(finalColor, 0.0, 1.0), 1.0);
                }
            }
        `;

        // Compile shaders
        const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        // Create program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            throw new Error('Shader program failed to link: ' + gl.getProgramInfoLog(this.program));
        }

        // Get attribute and uniform locations
        this.attribLocations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            texCoord: gl.getAttribLocation(this.program, 'a_texCoord')
        };

        this.uniformLocations = {
            coeffTex0: gl.getUniformLocation(this.program, 'u_coeffTex0'),
            coeffTex1: gl.getUniformLocation(this.program, 'u_coeffTex1'),
            rgbTex: gl.getUniformLocation(this.program, 'u_rgbTex'),
            normalTex: gl.getUniformLocation(this.program, 'u_normalTex'),
            lightDir: gl.getUniformLocation(this.program, 'u_lightDir'),
            viewMode: gl.getUniformLocation(this.program, 'u_viewMode'),
            specularEnhancement: gl.getUniformLocation(this.program, 'u_specularEnhancement'),
            diffuseGain: gl.getUniformLocation(this.program, 'u_diffuseGain')
        };
    }

    /**
     * Compile a WebGL shader
     */
    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Shader compilation failed: ' + info);
        }

        return shader;
    }

    /**
     * Initialize vertex buffers for a full-screen quad
     */
    initBuffers() {
        const gl = this.gl;

        // Vertex positions (full-screen quad)
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]);

        // Texture coordinates
        const texCoords = new Float32Array([
            0, 1,
            1, 1,
            0, 0,
            1, 0
        ]);

        // Create position buffer
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        // Create texture coordinate buffer
        this.texCoordBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);
    }

    /**
     * Load PTM data and create textures
     */
    loadPTM(ptmData) {
        const gl = this.gl;
        this.ptmData = ptmData;

        // Resize canvas to match PTM dimensions
        this.canvas.width = ptmData.width;
        this.canvas.height = ptmData.height;
        gl.viewport(0, 0, ptmData.width, ptmData.height);

        // Create coefficient textures
        this.createCoefficientTextures(ptmData);

        // Create RGB texture
        this.createRGBTexture(ptmData);

        // Create normal texture
        this.createNormalTexture(ptmData);

        // Initial render
        this.render();
    }

    /**
     * Create textures for PTM coefficients
     * Pack coefficients into RGB textures for efficiency
     */
    createCoefficientTextures(ptmData) {
        const gl = this.gl;
        const { width, height, coefficients } = ptmData;
        const pixelCount = width * height;

        // First texture: a0, a1, a2 packed into RGB
        const coeff0Data = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            // Normalize coefficients to 0-255 range (assuming -2 to 2 range)
            coeff0Data[i * 4] = Math.floor((coefficients[0][i] / 4 + 0.5) * 255);
            coeff0Data[i * 4 + 1] = Math.floor((coefficients[1][i] / 4 + 0.5) * 255);
            coeff0Data[i * 4 + 2] = Math.floor((coefficients[2][i] / 4 + 0.5) * 255);
            coeff0Data[i * 4 + 3] = 255;
        }

        this.coeffTex0 = this.createTexture(coeff0Data, width, height);

        // Second texture: a3, a4, a5 packed into RGB
        const coeff1Data = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            coeff1Data[i * 4] = Math.floor((coefficients[3][i] / 4 + 0.5) * 255);
            coeff1Data[i * 4 + 1] = Math.floor((coefficients[4][i] / 4 + 0.5) * 255);
            coeff1Data[i * 4 + 2] = Math.floor(Math.max(0, Math.min(1, coefficients[5][i] / 2)) * 255);
            coeff1Data[i * 4 + 3] = 255;
        }

        this.coeffTex1 = this.createTexture(coeff1Data, width, height);
    }

    /**
     * Create texture for base RGB color
     */
    createRGBTexture(ptmData) {
        const gl = this.gl;
        const { width, height, rgb } = ptmData;
        const pixelCount = width * height;

        // Convert RGB to RGBA
        const rgbaData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            rgbaData[i * 4] = rgb[i * 3];
            rgbaData[i * 4 + 1] = rgb[i * 3 + 1];
            rgbaData[i * 4 + 2] = rgb[i * 3 + 2];
            rgbaData[i * 4 + 3] = 255;
        }

        this.rgbTex = this.createTexture(rgbaData, width, height);
    }

    /**
     * Create texture for normal map
     */
    createNormalTexture(ptmData) {
        const gl = this.gl;
        const { width, height, normals } = ptmData;
        const pixelCount = width * height;

        // Convert normals to 0-255 range
        const normalData = new Uint8Array(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            normalData[i * 4] = Math.floor((normals[i * 3] * 0.5 + 0.5) * 255);
            normalData[i * 4 + 1] = Math.floor((normals[i * 3 + 1] * 0.5 + 0.5) * 255);
            normalData[i * 4 + 2] = Math.floor((normals[i * 3 + 2] * 0.5 + 0.5) * 255);
            normalData[i * 4 + 3] = 255;
        }

        this.normalTex = this.createTexture(normalData, width, height);
    }

    /**
     * Create a WebGL texture from pixel data
     */
    createTexture(data, width, height) {
        const gl = this.gl;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);

        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            width,
            height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data
        );

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        return texture;
    }

    /**
     * Set light direction
     * @param {number} x - Light X direction (-1 to 1)
     * @param {number} y - Light Y direction (-1 to 1)
     */
    setLightDirection(x, y) {
        this.lightX = Math.max(-1, Math.min(1, x));
        this.lightY = Math.max(-1, Math.min(1, y));
        this.render();
    }

    /**
     * Set view mode
     * @param {string} mode - 'default', 'specular', or 'normals'
     */
    setViewMode(mode) {
        this.viewMode = mode;
        this.render();
    }

    /**
     * Set specular enhancement factor
     */
    setSpecularEnhancement(value) {
        this.specularEnhancement = value;
        this.render();
    }

    /**
     * Set diffuse gain factor
     */
    setDiffuseGain(value) {
        this.diffuseGain = value;
        this.render();
    }

    /**
     * Render the PTM with current settings
     */
    render() {
        if (!this.ptmData) return;

        const gl = this.gl;

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.attribLocations.position);
        gl.vertexAttribPointer(this.attribLocations.position, 2, gl.FLOAT, false, 0, 0);

        // Bind texture coordinate buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.enableVertexAttribArray(this.attribLocations.texCoord);
        gl.vertexAttribPointer(this.attribLocations.texCoord, 2, gl.FLOAT, false, 0, 0);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.coeffTex0);
        gl.uniform1i(this.uniformLocations.coeffTex0, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.coeffTex1);
        gl.uniform1i(this.uniformLocations.coeffTex1, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.rgbTex);
        gl.uniform1i(this.uniformLocations.rgbTex, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, this.normalTex);
        gl.uniform1i(this.uniformLocations.normalTex, 3);

        // Set uniforms
        gl.uniform2f(this.uniformLocations.lightDir, this.lightX, this.lightY);

        const viewModeInt = this.viewMode === 'normals' ? 2 : (this.viewMode === 'specular' ? 1 : 0);
        gl.uniform1i(this.uniformLocations.viewMode, viewModeInt);

        gl.uniform1f(this.uniformLocations.specularEnhancement, this.specularEnhancement);
        gl.uniform1f(this.uniformLocations.diffuseGain, this.diffuseGain);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Clean up WebGL resources
     */
    dispose() {
        const gl = this.gl;

        if (this.coeffTex0) gl.deleteTexture(this.coeffTex0);
        if (this.coeffTex1) gl.deleteTexture(this.coeffTex1);
        if (this.rgbTex) gl.deleteTexture(this.rgbTex);
        if (this.normalTex) gl.deleteTexture(this.normalTex);
        if (this.positionBuffer) gl.deleteBuffer(this.positionBuffer);
        if (this.texCoordBuffer) gl.deleteBuffer(this.texCoordBuffer);
        if (this.program) gl.deleteProgram(this.program);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RTIRenderer;
}
