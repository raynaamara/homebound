# Third-party notices and data provenance

The [Apache-2.0 license](LICENSE) covers original HOMEBOUND code and accompanying project-authored documentation. It does **not** grant new rights in third-party material. NASA resources are not relicensed as HOMEBOUND software. Retain the following credits when redistributing relevant data, images or demo assets.

## NASA mission-derived material

### MRO / HiRISE

**Credit:** NASA/JPL-Caltech/University of Arizona.

- DTM: `DTEEC_012340_1750_012195_1750_A01`.
- [DTM provider page](https://www.uahirise.org/dtm/dtm.php?ID=ESP_012340_1750).
- Orthorectified optical image: `ESP_012195_1750_RED_C_01_ORTHO`.
- [Observation / image provider page](https://www.uahirise.org/ESP_012195_1750).
- [HiRISE image-use policy](https://hirise.lpl.arizona.edu/media/usage.php).

The prepared grid supplies elevation and derived slope to the route engine. The optical display and S crop are processed views of the recorded NASA product, not generated terrain. Prepared displays are not the full-resolution original products.

### Mars Odyssey / THEMIS

**Credit:** NASA/JPL-Caltech/Arizona State University.

- Product identifier: `Gale_crater_THEMIS_qualTI`.
- [Gale Crater product page](https://themis.mars.asu.edu/landingsites/mslsite_42).
- [THEMIS provider](https://themis.mars.asu.edu/).

The native approximately 100 m context is qualitative DN information. It is not calibrated surface temperature or physical thermal inertia and does not determine route cost.

### Mars Global Surveyor / MOLA, via NASA Mars Trek

**Credit:** NASA/MGS; map service NASA Mars Trek.

- Layer: `Mars_MGS_MOLA_ClrShade_merge_global_463m`.
- [NASA Mars Trek](https://trek.nasa.gov/mars/).
- [Layer WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml).

Four cached original tiles and retrieval records support the local regional map. The larger locator ring is a visibility aid, not a route or an exact S marker. MOLA provides regional orientation only, not routing elevation or an extra detailed map layer.

### Usage boundary

See the providers' usage information and [NASA media usage guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/) before reusing material. NASA names, emblems, logos and third-party rights are not granted by the project license. No NASA, agency, university or artist endorsement is implied.

Exact URLs, preparation roles and source/processed SHA-256 hashes are in the [source catalog](data/homebound/web/sources.json), [regional record](data/homebound/web/regional-context.json) and associated data files. Large original HiRISE/THEMIS downloads are not bundled in this repository.

## Demonstration soundtrack

The following credit is reproduced from the accompanying [music-credit file](docs/demo/HOMEBOUND_App_Demo_Music_Credit_EN.txt):

> "Cipher" Kevin MacLeod (incompetech.com)  
> Licensed under Creative Commons: By Attribution 4.0 License  
> https://creativecommons.org/licenses/by/4.0/
>
> Original track:  
> https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844
>
> Audio edits for HOMEBOUND by NUSA NOVA: a continuous 29-second excerpt (00:30-00:59), volume adjustment, a short fade-in and fade-out. No pitch or tempo changes.

CC BY 4.0 applies to the soundtrack, not Apache-2.0. The complete original recording is not bundled.

## Software dependencies and production tools

No third-party JavaScript runtime or CDN is required by the deployed application. Development dependencies are installed separately using the [locked npm manifest](decision-model/package-lock.json), rather than bundled here:

- [TypeScript](https://github.com/microsoft/TypeScript), Apache-2.0.
- [Node.js type definitions / DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped), MIT.
- Transitive or platform-specific packages retain their upstream licenses and notices, supplied with their installed packages.

Optional document/browser QA tools are listed in [requirements-docs.txt](decision-model/requirements-docs.txt). Their packages and upstream licenses are not replaced by the HOMEBOUND license. PowerPoint/Word-generated document outputs do not redistribute those applications.

## Reference tools

[NASA Mars Trek](https://trek.nasa.gov/mars/) and [JMARS](https://jmars.asu.edu/) are acknowledged related mapping/analysis tools, not HOMEBOUND inventions. Separately from that comparison, actual Mars Trek MOLA tiles are included as regional data.

