/**
 * RTI Viewer Application
 *
 * Main application logic for the RTI file viewer.
 * Handles file upload, UI interactions, and light control.
 */

class RTIViewerApp {
    constructor() {
        this.renderer = null;
        this.parser = new PTMParser();
        this.isDragging = false;

        this.initElements();
        this.bindEvents();
    }

    /**
     * Initialize DOM element references
     */
    initElements() {
        // Upload section elements
        this.uploadSection = document.getElementById('uploadSection');
        this.uploadArea = document.getElementById('uploadArea');
        this.fileInput = document.getElementById('fileInput');
        this.browseBtn = document.getElementById('browseBtn');
        this.loadDemoBtn = document.getElementById('loadDemoBtn');

        // Viewer section elements
        this.viewerSection = document.getElementById('viewerSection');
        this.canvas = document.getElementById('rtiCanvas');
        this.lightControl = document.getElementById('lightControl');
        this.lightIndicator = document.getElementById('lightIndicator');

        // Control elements
        this.modeButtons = document.querySelectorAll('.mode-btn');
        this.specularSlider = document.getElementById('specularSlider');
        this.specularValue = document.getElementById('specularValue');
        this.diffuseSlider = document.getElementById('diffuseSlider');
        this.diffuseValue = document.getElementById('diffuseValue');
        this.newFileBtn = document.getElementById('newFileBtn');

        // Info displays
        this.lightXDisplay = document.getElementById('lightX');
        this.lightYDisplay = document.getElementById('lightY');
        this.imageDimensions = document.getElementById('imageDimensions');
        this.imageFormat = document.getElementById('imageFormat');

        // Loading overlay
        this.loadingOverlay = document.getElementById('loadingOverlay');
    }

    /**
     * Bind event listeners
     */
    bindEvents() {
        // File upload events
        this.browseBtn.addEventListener('click', () => this.fileInput.click());
        this.uploadArea.addEventListener('click', (e) => {
            if (e.target === this.uploadArea || e.target.closest('.upload-area')) {
                this.fileInput.click();
            }
        });

        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        // Drag and drop events
        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadArea.classList.add('dragover');
        });

        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.loadFile(files[0]);
            }
        });

        // Demo button
        this.loadDemoBtn.addEventListener('click', () => this.loadDemo());

        // Light control events
        this.lightControl.addEventListener('mousedown', (e) => this.startLightDrag(e));
        document.addEventListener('mousemove', (e) => this.handleLightDrag(e));
        document.addEventListener('mouseup', () => this.endLightDrag());

        // Touch events for mobile
        this.lightControl.addEventListener('touchstart', (e) => this.startLightDrag(e));
        document.addEventListener('touchmove', (e) => this.handleLightDrag(e));
        document.addEventListener('touchend', () => this.endLightDrag());

        // View mode buttons
        this.modeButtons.forEach(btn => {
            btn.addEventListener('click', () => this.setViewMode(btn.dataset.mode));
        });

        // Sliders
        this.specularSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.specularValue.textContent = value.toFixed(1);
            if (this.renderer) {
                this.renderer.setSpecularEnhancement(value);
            }
        });

        this.diffuseSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            this.diffuseValue.textContent = value.toFixed(1);
            if (this.renderer) {
                this.renderer.setDiffuseGain(value);
            }
        });

        // New file button
        this.newFileBtn.addEventListener('click', () => this.showUploadSection());
    }

    /**
     * Handle file selection from input
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) {
            this.loadFile(file);
        }
    }

    /**
     * Load a PTM file
     */
    async loadFile(file) {
        if (!file.name.toLowerCase().endsWith('.ptm')) {
            alert('Please select a PTM file (.ptm)');
            return;
        }

        this.showLoading(true);

        try {
            const buffer = await file.arrayBuffer();
            const ptmData = await this.parser.parse(buffer);

            this.initViewer(ptmData);
            this.showViewerSection();
        } catch (error) {
            console.error('Error loading PTM file:', error);
            alert('Error loading PTM file: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Load demo PTM data
     */
    loadDemo() {
        this.showLoading(true);

        // Use setTimeout to allow the loading overlay to render
        setTimeout(() => {
            try {
                const ptmData = PTMParser.createDemoData(512, 512);
                this.initViewer(ptmData);
                this.showViewerSection();
            } catch (error) {
                console.error('Error creating demo:', error);
                alert('Error creating demo: ' + error.message);
            } finally {
                this.showLoading(false);
            }
        }, 100);
    }

    /**
     * Initialize the WebGL renderer with PTM data
     */
    initViewer(ptmData) {
        // Clean up existing renderer
        if (this.renderer) {
            this.renderer.dispose();
        }

        // Create new renderer
        this.renderer = new RTIRenderer(this.canvas);
        this.renderer.loadPTM(ptmData);

        // Update info display
        this.imageDimensions.textContent = `${ptmData.width} x ${ptmData.height}`;
        this.imageFormat.textContent = ptmData.format;

        // Reset controls
        this.setLightPosition(0, 0);
        this.setViewMode('default');
        this.specularSlider.value = 1;
        this.specularValue.textContent = '1.0';
        this.diffuseSlider.value = 1;
        this.diffuseValue.textContent = '1.0';
    }

    /**
     * Start dragging the light control
     */
    startLightDrag(event) {
        event.preventDefault();
        this.isDragging = true;
        this.updateLightFromEvent(event);
    }

    /**
     * Handle light control dragging
     */
    handleLightDrag(event) {
        if (!this.isDragging) return;
        event.preventDefault();
        this.updateLightFromEvent(event);
    }

    /**
     * End light control dragging
     */
    endLightDrag() {
        this.isDragging = false;
    }

    /**
     * Update light position from mouse/touch event
     */
    updateLightFromEvent(event) {
        const rect = this.lightControl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const radius = rect.width / 2;

        // Get client position (mouse or touch)
        let clientX, clientY;
        if (event.touches && event.touches.length > 0) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
        }

        // Calculate normalized position (-1 to 1)
        let x = (clientX - centerX) / radius;
        let y = -(clientY - centerY) / radius; // Flip Y for intuitive control

        // Clamp to unit circle
        const mag = Math.sqrt(x * x + y * y);
        if (mag > 1) {
            x /= mag;
            y /= mag;
        }

        this.setLightPosition(x, y);
    }

    /**
     * Set light position and update UI
     */
    setLightPosition(x, y) {
        // Update indicator position
        const radius = this.lightControl.offsetWidth / 2;
        const indicatorX = 50 + x * 45; // Percentage from center
        const indicatorY = 50 - y * 45; // Flip Y and convert to percentage

        this.lightIndicator.style.left = `${indicatorX}%`;
        this.lightIndicator.style.top = `${indicatorY}%`;

        // Update display
        this.lightXDisplay.textContent = x.toFixed(2);
        this.lightYDisplay.textContent = y.toFixed(2);

        // Update renderer
        if (this.renderer) {
            this.renderer.setLightDirection(x, y);
        }
    }

    /**
     * Set the view mode
     */
    setViewMode(mode) {
        // Update button states
        this.modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        // Update renderer
        if (this.renderer) {
            this.renderer.setViewMode(mode);
        }
    }

    /**
     * Show loading overlay
     */
    showLoading(show) {
        this.loadingOverlay.style.display = show ? 'flex' : 'none';
    }

    /**
     * Show the viewer section, hide upload section
     */
    showViewerSection() {
        this.uploadSection.style.display = 'none';
        this.viewerSection.style.display = 'flex';
    }

    /**
     * Show upload section, hide viewer
     */
    showUploadSection() {
        this.viewerSection.style.display = 'none';
        this.uploadSection.style.display = 'block';
        this.fileInput.value = ''; // Reset file input
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.rtiApp = new RTIViewerApp();
});
