# Prepared data

This folder preserves the source package's small NASA-derived application inputs and provenance. It is a sibling of [decision-model](../decision-model/); keep that layout because build and audit scripts resolve it relatively.

## Start here

- [homebound/web/](homebound/web/): browser-ready terrain grid, scenario, images and source records.
- [Source catalog](homebound/web/sources.json): product identities, source URLs/hashes and actual roles.
- [Regional context](homebound/web/regional-context.json): MOLA service/layer, four original tiles, projection checks and processed-map hash.
- [Original spatial-reference metadata](homebound/metadata/spatial_reference.json): the recorded metric Mars projection used for the regional footprint.

The detailed study window is approximately 1.52 km across. HiRISE elevation and derived slope drive routing; HiRISE optical imagery supports interpretation. THEMIS is qualitative regional context, not a temperature measurement or route penalty. MOLA supplies the separate Gale Crater orientation map, not routing input.

Small cached regional originals/receipts are included for reproducibility. Large raw DTM, orthophoto and THEMIS products are not; obtain them from the recorded providers if independently repeating upstream preparation. Browser builds use the prepared inputs already supplied.

## Preserve provenance

Do not reformat, normalize line endings, resample or overwrite these files as a housekeeping step. Their exact bytes are checked by SHA-256 preservation and build checks. `.gitattributes` intentionally disables Git text conversion.

If intentionally replacing a scientific input in future development, update its preparation/provenance and affected checks explicitly. Do not simply replace expected hashes to conceal a data change.

Credits and external rights are described in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). These products are not relicensed as Apache-2.0 software.
