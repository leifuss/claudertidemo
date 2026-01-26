/**
 * PTM (Polynomial Texture Map) Parser
 *
 * Parses PTM files used in Reflectance Transformation Imaging (RTI).
 * Supports PTM_FORMAT_LRGB and PTM_FORMAT_RGB formats.
 *
 * Based on the PTM file format specification by HP Labs.
 * Reference: http://www.hpl.hp.com/research/ptm/downloads/PtmFormat12.pdf
 */

class PTMParser {
    constructor() {
        this.PTM_FORMATS = {
            'PTM_FORMAT_RGB': 0,
            'PTM_FORMAT_LUM': 1,
            'PTM_FORMAT_LRGB': 2,
            'PTM_FORMAT_JPEG_RGB': 3,
            'PTM_FORMAT_JPEG_LRGB': 4,
            'PTM_FORMAT_JPEGLS_RGB': 5,
            'PTM_FORMAT_JPEGLS_LRGB': 6
        };
    }

    /**
     * Parse a PTM file from an ArrayBuffer
     * @param {ArrayBuffer} buffer - The file data
     * @returns {Object} Parsed PTM data with coefficients and metadata
     */
    async parse(buffer) {
        const dataView = new DataView(buffer);

        let offset = 0;

        // Read header lines (PTM format has 6 header lines)
        const headerLines = [];
        let currentLine = '';

        while (headerLines.length < 6) {
            const byte = dataView.getUint8(offset++);
            const char = String.fromCharCode(byte);

            if (char === '\n') {
                headerLines.push(currentLine.trim());
                currentLine = '';
            } else if (char !== '\r') {
                currentLine += char;
            }
        }

        // Parse header
        // Line 0: Version (e.g., "PTM_1.2")
        const version = headerLines[0];
        if (!version.startsWith('PTM_1.')) {
            throw new Error(`Unsupported PTM version: ${version}`);
        }

        // Line 1: Format (e.g., "PTM_FORMAT_LRGB")
        const format = headerLines[1];
        if (!(format in this.PTM_FORMATS)) {
            throw new Error(`Unsupported PTM format: ${format}`);
        }

        // Line 2: Width
        // Line 3: Height
        const width = parseInt(headerLines[2]);
        const height = parseInt(headerLines[3]);

        // Line 4: Scale coefficients (6 floats)
        const scale = headerLines[4].split(/\s+/).map(Number);

        // Line 5: Bias coefficients (6 integers)
        const bias = headerLines[5].split(/\s+/).map(Number);

        console.log('PTM Header:', {
            version,
            format,
            width,
            height,
            scale,
            bias
        });

        // Debug: Show first bytes of pixel data to understand layout
        console.log('=== RAW DATA ANALYSIS ===');
        console.log('Header ended at byte offset:', offset);
        console.log('Expected pixel data size:', width * height * 9, 'bytes');
        console.log('Actual remaining bytes:', buffer.byteLength - offset);

        // Dump first 36 bytes (4 pixels worth) to see pattern
        const firstBytes = [];
        for (let i = 0; i < 36; i++) {
            firstBytes.push(dataView.getUint8(offset + i));
        }
        console.log('First 36 bytes of pixel data:', firstBytes);
        console.log('As groups of 9:', [
            firstBytes.slice(0, 9),
            firstBytes.slice(9, 18),
            firstBytes.slice(18, 27),
            firstBytes.slice(27, 36)
        ]);

        // Also dump bytes at start of second scanline
        const secondLineStart = offset + width * 9;
        const secondLineBytes = [];
        for (let i = 0; i < 18; i++) {
            secondLineBytes.push(dataView.getUint8(secondLineStart + i));
        }
        console.log('First 18 bytes of line 2 (offset ' + secondLineStart + '):', secondLineBytes);

        // Parse pixel data based on format
        let ptmData;

        if (format === 'PTM_FORMAT_LRGB' || format === 'PTM_FORMAT_RGB') {
            ptmData = this.parseUncompressedPTM(buffer, offset, width, height, format, scale, bias);
        } else if (format === 'PTM_FORMAT_JPEG_LRGB' || format === 'PTM_FORMAT_JPEG_RGB') {
            ptmData = await this.parseJPEGPTM(buffer, offset, width, height, format, scale, bias);
        } else {
            throw new Error(`Format ${format} not yet implemented`);
        }

        return {
            version,
            format,
            width,
            height,
            scale,
            bias,
            ...ptmData
        };
    }

    /**
     * Parse uncompressed PTM data (LRGB or RGB format)
     *
     * PTM_1.2 uses PLANAR storage:
     * - First: 6 coefficient planes (each width*height bytes)
     * - Then: RGB data (width*height*3 bytes)
     * - Scanlines stored bottom-to-top
     */
    parseUncompressedPTM(buffer, offset, width, height, format, scale, bias) {
        const dataView = new DataView(buffer);
        const pixelCount = width * height;

        const isLRGB = format === 'PTM_FORMAT_LRGB';

        // Allocate arrays for coefficients
        const coefficients = new Array(6);
        for (let i = 0; i < 6; i++) {
            coefficients[i] = new Float32Array(pixelCount);
        }

        const rgb = new Uint8Array(pixelCount * 3);

        if (isLRGB) {
            // PTM_1.2 LRGB format:
            // Coefficients are interleaved per-pixel (6 bytes per pixel)
            // Then RGB data comes after (3 bytes per pixel)
            // Scanlines stored bottom-to-top

            console.log('Parsing PTM_1.2 LRGB - coefficients interleaved, then RGB');

            // Read interleaved coefficients: [a0,a1,a2,a3,a4,a5] per pixel
            for (let y = 0; y < height; y++) {
                // PTM stores bottom-to-top, we want top-to-bottom
                const srcY = height - 1 - y;

                for (let x = 0; x < width; x++) {
                    const srcPixel = srcY * width + x;
                    const destPixel = y * width + x;
                    const srcIdx = offset + srcPixel * 6; // 6 coefficients per pixel

                    // Read 6 coefficients for this pixel
                    for (let c = 0; c < 6; c++) {
                        const rawValue = dataView.getUint8(srcIdx + c);
                        coefficients[c][destPixel] = (rawValue - bias[c]) * scale[c];
                    }
                }
            }

            // Read RGB data (after all coefficient data: 6 bytes * pixelCount)
            const rgbOffset = offset + 6 * pixelCount;

            for (let y = 0; y < height; y++) {
                // PTM stores bottom-to-top
                const srcY = height - 1 - y;

                for (let x = 0; x < width; x++) {
                    const srcPixel = srcY * width + x;
                    const destPixel = y * width + x;
                    const srcIdx = rgbOffset + srcPixel * 3;

                    rgb[destPixel * 3] = dataView.getUint8(srcIdx);
                    rgb[destPixel * 3 + 1] = dataView.getUint8(srcIdx + 1);
                    rgb[destPixel * 3 + 2] = dataView.getUint8(srcIdx + 2);
                }
            }

            console.log('Coefficient[0] first 10 values:', Array.from(coefficients[0].slice(0, 10)));
            console.log('Coefficient[5] first 10 values:', Array.from(coefficients[5].slice(0, 10)));
            console.log('RGB first 10 values:', Array.from(rgb.slice(0, 10)));
        } else {
            // RGB format: 18 coefficient planes (6 per channel)
            // For simplicity, we'll convert to LRGB-style by averaging coefficients

            for (let c = 0; c < 6; c++) {
                // Average across R, G, B channels
                for (let ch = 0; ch < 3; ch++) {
                    const planeOffset = offset + (ch * 6 + c) * pixelCount;

                    for (let y = 0; y < height; y++) {
                        const srcY = height - 1 - y;

                        for (let x = 0; x < width; x++) {
                            const srcIdx = planeOffset + srcY * width + x;
                            const destIdx = y * width + x;

                            const rawValue = dataView.getUint8(srcIdx);
                            const coefValue = (rawValue - bias[c]) * scale[c];

                            if (ch === 0) {
                                coefficients[c][destIdx] = coefValue;
                            } else {
                                coefficients[c][destIdx] += coefValue;
                            }
                        }
                    }
                }

                // Average the coefficients
                for (let i = 0; i < pixelCount; i++) {
                    coefficients[c][i] /= 3;
                }
            }

            // For RGB format, compute representative color at neutral light
            // Use the constant coefficient (a5) for each channel
            const a5Offset = 5;
            for (let y = 0; y < height; y++) {
                const srcY = height - 1 - y;

                for (let x = 0; x < width; x++) {
                    const destIdx = y * width + x;

                    for (let ch = 0; ch < 3; ch++) {
                        const planeOffset = offset + (ch * 6 + a5Offset) * pixelCount;
                        const srcIdx = planeOffset + srcY * width + x;
                        rgb[destIdx * 3 + ch] = dataView.getUint8(srcIdx);
                    }
                }
            }
        }

        // Compute normals from coefficients
        const normals = this.computeNormals(coefficients, width, height);

        return {
            coefficients,
            rgb,
            normals
        };
    }

    /**
     * Parse JPEG-compressed PTM data
     * This is a simplified parser - full implementation would need JPEG decoding
     */
    async parseJPEGPTM(buffer, offset, width, height, format, scale, bias) {
        // JPEG PTM has additional header lines for compression info
        // For now, throw an error as full JPEG support requires more work
        throw new Error('JPEG-compressed PTM files are not yet supported. Please use uncompressed PTM files.');
    }

    /**
     * Compute surface normals from PTM coefficients
     * The normal direction can be estimated from the polynomial gradient
     */
    computeNormals(coefficients, width, height) {
        const pixelCount = width * height;
        const normals = new Float32Array(pixelCount * 3);

        for (let i = 0; i < pixelCount; i++) {
            // Coefficients: a0*lu² + a1*lv² + a2*lu*lv + a3*lu + a4*lv + a5
            // Gradient at (0,0): dL/dlu = a3, dL/dlv = a4
            // Normal points in direction of maximum luminance

            const a3 = coefficients[3][i]; // dL/dlu at origin
            const a4 = coefficients[4][i]; // dL/dlv at origin

            // The gradient points toward the light direction that maximizes luminance
            // For a Lambertian surface, this is the surface normal direction
            let nx = a3;
            let ny = a4;

            // Compute nz from the constraint that |n| should be 1
            // We want nx² + ny² + nz² = 1, assuming normal points "up"
            const nxySquared = nx * nx + ny * ny;
            let nz;

            if (nxySquared >= 1) {
                // Normalize to unit circle in xy plane, z = 0
                const mag = Math.sqrt(nxySquared);
                nx /= mag;
                ny /= mag;
                nz = 0;
            } else {
                nz = Math.sqrt(1 - nxySquared);
            }

            normals[i * 3] = nx;
            normals[i * 3 + 1] = ny;
            normals[i * 3 + 2] = nz;
        }

        return normals;
    }

    /**
     * Create a demo PTM dataset (a synthetic bump pattern)
     * Useful for testing when no PTM file is available
     */
    static createDemoData(width = 512, height = 512) {
        const pixelCount = width * height;

        const coefficients = new Array(6);
        for (let i = 0; i < 6; i++) {
            coefficients[i] = new Float32Array(pixelCount);
        }

        const rgb = new Uint8Array(pixelCount * 3);
        const normals = new Float32Array(pixelCount * 3);

        // Create a pattern with bumps and text-like features
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                // Normalized coordinates
                const u = x / width;
                const v = y / height;

                // Create some interesting surface features
                // Multiple overlapping sine bumps at different frequencies
                const bump1 = Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI * 6) * 0.3;
                const bump2 = Math.sin(u * Math.PI * 12 + 1) * Math.sin(v * Math.PI * 12 + 0.5) * 0.15;
                const bump3 = Math.sin(u * Math.PI * 3) * Math.sin(v * Math.PI * 3) * 0.2;

                // Circular bump in center
                const cx = 0.5, cy = 0.5;
                const dist = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy));
                const centralBump = Math.exp(-dist * dist * 20) * 0.5;

                // Ring pattern
                const ring = Math.sin(dist * Math.PI * 10) * Math.exp(-dist * 3) * 0.2;

                // Compute combined height and derivatives
                const h = bump1 + bump2 + bump3 + centralBump + ring;

                // Numerical derivatives for normal computation
                const eps = 0.001;
                const u2 = (x + 1) / width;
                const v2 = (y + 1) / height;

                const dist2x = Math.sqrt((u2 - cx) * (u2 - cx) + (v - cy) * (v - cy));
                const dist2y = Math.sqrt((u - cx) * (u - cx) + (v2 - cy) * (v2 - cy));

                const h_dx = (
                    Math.sin(u2 * Math.PI * 6) * Math.sin(v * Math.PI * 6) * 0.3 +
                    Math.sin(u2 * Math.PI * 12 + 1) * Math.sin(v * Math.PI * 12 + 0.5) * 0.15 +
                    Math.sin(u2 * Math.PI * 3) * Math.sin(v * Math.PI * 3) * 0.2 +
                    Math.exp(-dist2x * dist2x * 20) * 0.5 +
                    Math.sin(dist2x * Math.PI * 10) * Math.exp(-dist2x * 3) * 0.2
                ) - h;

                const h_dy = (
                    Math.sin(u * Math.PI * 6) * Math.sin(v2 * Math.PI * 6) * 0.3 +
                    Math.sin(u * Math.PI * 12 + 1) * Math.sin(v2 * Math.PI * 12 + 0.5) * 0.15 +
                    Math.sin(u * Math.PI * 3) * Math.sin(v2 * Math.PI * 3) * 0.2 +
                    Math.exp(-dist2y * dist2y * 20) * 0.5 +
                    Math.sin(dist2y * Math.PI * 10) * Math.exp(-dist2y * 3) * 0.2
                ) - h;

                // Compute normal from derivatives
                let nx = -h_dx * 5;
                let ny = -h_dy * 5;
                let nz = 1;
                const mag = Math.sqrt(nx * nx + ny * ny + nz * nz);
                nx /= mag;
                ny /= mag;
                nz /= mag;

                normals[idx * 3] = nx;
                normals[idx * 3 + 1] = ny;
                normals[idx * 3 + 2] = nz;

                // Set PTM coefficients based on the normal
                // The polynomial: a0*lu² + a1*lv² + a2*lu*lv + a3*lu + a4*lv + a5
                // For a Lambertian surface with normal (nx, ny, nz):
                // Luminance = max(0, nx*lu + ny*lv + nz)
                // We approximate this with the polynomial

                // Linear terms (most important for relighting)
                coefficients[3][idx] = nx;  // coefficient for lu
                coefficients[4][idx] = ny;  // coefficient for lv
                coefficients[5][idx] = nz * 0.5; // constant term (ambient)

                // Quadratic terms (for specular-like effects)
                coefficients[0][idx] = -0.3 * (1 - nx * nx);  // lu²
                coefficients[1][idx] = -0.3 * (1 - ny * ny);  // lv²
                coefficients[2][idx] = -0.3 * nx * ny;        // lu*lv

                // Set base color (warm stone-like color)
                const baseColor = 180 + h * 40;
                rgb[idx * 3] = Math.min(255, Math.max(0, baseColor + 20));     // R
                rgb[idx * 3 + 1] = Math.min(255, Math.max(0, baseColor));       // G
                rgb[idx * 3 + 2] = Math.min(255, Math.max(0, baseColor - 30));  // B
            }
        }

        return {
            version: 'PTM_1.2',
            format: 'PTM_FORMAT_LRGB',
            width,
            height,
            scale: [1, 1, 1, 1, 1, 1],
            bias: [0, 0, 0, 0, 0, 0],
            coefficients,
            rgb,
            normals
        };
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PTMParser;
}
