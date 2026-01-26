# RTI Viewer

A web-based viewer for Reflectance Transformation Imaging (RTI) files, built with vanilla JavaScript and WebGL. This viewer allows you to interactively relight PTM (Polynomial Texture Map) files directly in your browser.

## Features

- **Interactive Relighting**: Click and drag the light control to change the virtual light source direction in real-time
- **Multiple View Modes**:
  - **Default**: Full-color view with diffuse lighting and specular highlights
  - **Specular**: Shows only the specular (shiny) components, useful for examining surface reflectance
  - **Normals**: Visualizes the computed surface normal map
- **File Upload**: Load your own PTM files via drag-and-drop or file browser
- **Demo Mode**: Try the viewer with a synthetic demo image
- **Adjustable Parameters**: Control specular enhancement and diffuse gain

## Live Demo

Visit the GitHub Pages deployment to try the viewer: [RTI Viewer](https://[username].github.io/claudertidemo/)

## Usage

1. Open `index.html` in a modern web browser
2. Either:
   - Click "Load Demo Image" to see a synthetic example
   - Upload a PTM file using drag-and-drop or the file browser
3. Use the circular light control (bottom-right of the image) to change the light direction
4. Switch between view modes using the buttons in the control panel
5. Adjust specular enhancement and diffuse gain sliders to fine-tune the visualization

## Supported File Formats

- **PTM_FORMAT_LRGB**: Luminance RGB format (recommended)
- **PTM_FORMAT_RGB**: Full RGB coefficient format

## Technology

This viewer is built using:

- **Vanilla JavaScript**: No frameworks required
- **WebGL**: GPU-accelerated rendering for real-time relighting
- **PTM Algorithm**: Implements the polynomial texture mapping formula:
  ```
  L = a0*lu² + a1*lv² + a2*lu*lv + a3*lu + a4*lv + a5
  ```
  Where `lu` and `lv` are the light direction components.

## How RTI Works

Reflectance Transformation Imaging captures how a surface reflects light from different directions. By taking multiple photographs with controlled lighting, the technique creates a mathematical model of the surface's reflectance properties.

The PTM format stores polynomial coefficients for each pixel that describe how luminance changes with light direction. This allows interactive relighting after capture, revealing surface details like:

- Inscriptions and engravings
- Surface textures
- Subtle relief details
- Wear patterns

## Project Structure

```
claudertidemo/
├── index.html          # Main HTML page
├── css/
│   └── styles.css      # Application styles
├── js/
│   ├── ptm-parser.js   # PTM file format parser
│   ├── webgl-renderer.js # WebGL rendering engine
│   └── app.js          # Main application logic
└── README.md           # This file
```

## Browser Compatibility

Requires a browser with WebGL support:
- Chrome 9+
- Firefox 4+
- Safari 5.1+
- Edge 12+

## References

- [Cultural Heritage Imaging - RTI](https://culturalheritageimaging.org/Technologies/RTI/)
- [CNR-ISTI Visual Computing Lab - OpenLIME](https://github.com/cnr-isti-vclab/openlime)
- [PTM File Format Specification](http://www.hpl.hp.com/research/ptm/)
- [Polynomial Texture Maps (Malzbender et al., 2001)](https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Malzbender01.pdf)

## License

MIT License - Feel free to use and modify for your own projects.
