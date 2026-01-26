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
     */
    parseUncompressedPTM(buffer, offset, width, height, format, scale, bias) {
        const dataView = new DataView(buffer);
        const pixelCount = width * height;

        // For LRGB: 9 bytes per pixel (RGB + 6 coefficients)
        // For RGB: 18 bytes per pixel (6 coefficients per channel)
        const isLRGB = format === 'PTM_FORMAT_LRGB';
        const bytesPerPixel = isLRGB ? 9 : 18;

        // Allocate arrays for coefficients
        // We'll store 6 coefficient planes + RGB
        const coefficients = new Array(6);
        for (let i = 0; i < 6; i++) {
            coefficients[i] = new Float32Array(pixelCount);
        }

        const rgb = new Uint8Array(pixelCount * 3);

        if (isLRGB) {
            // LRGB format: Try interleaved [R, G, B, a0, a1, a2, a3, a4, a5] per pixel
            // Try WITHOUT bottom-up flip (read top-down as stored)

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const srcIdx = offset + (y * width + x) * 9;
                    const destIdx = y * width + x;  // No flip

                    // Read RGB first
                    rgb[destIdx * 3] = dataView.getUint8(srcIdx);
                    rgb[destIdx * 3 + 1] = dataView.getUint8(srcIdx + 1);
                    rgb[destIdx * 3 + 2] = dataView.getUint8(srcIdx + 2);

                    // Read 6 coefficients
                    for (let c = 0; c < 6; c++) {
                        const rawValue = dataView.getUint8(srcIdx + 3 + c);
                        coefficients[c][destIdx] = (rawValue - bias[c]) * scale[c];
                    }
                }
            }
        } else {
            // RGB format: separate coefficients for each channel
            // For simplicity, we'll convert to LRGB-style by averaging coefficients
            // This is a simplification - full RGB PTM would need 18 coefficient planes

            for (let y = 0; y < height; y++) {
                const destY = height - 1 - y;
                const lineOffset = offset + y * width * 18;

                for (let x = 0; x < width; x++) {
                    const srcIdx = lineOffset + x * 18;
                    const destIdx = destY * width + x;

                    // Average the coefficients across R, G, B channels for luminance
                    for (let c = 0; c < 6; c++) {
                        const rCoef = (dataView.getUint8(srcIdx + c) - bias[c]) * scale[c];
                        const gCoef = (dataView.getUint8(srcIdx + 6 + c) - bias[c]) * scale[c];
                        const bCoef = (dataView.getUint8(srcIdx + 12 + c) - bias[c]) * scale[c];
                        coefficients[c][destIdx] = (rCoef + gCoef + bCoef) / 3;
                    }

                    // Compute a representative RGB from the polynomial at neutral light
                    // Using light direction (0, 0) - from directly above
                    const lumR = dataView.getUint8(srcIdx + 5);
                    const lumG = dataView.getUint8(srcIdx + 11);
                    const lumB = dataView.getUint8(srcIdx + 17);
                    rgb[destIdx * 3] = lumR;
                    rgb[destIdx * 3 + 1] = lumG;
                    rgb[destIdx * 3 + 2] = lumB;
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
