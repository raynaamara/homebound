# Evidence scope

This directory contains supplied release evidence plus reports produced by the existing audit commands. It is not a claim that every historical test was freshly repeated for this public source package.

## Reproducible source checks

From [decision-model](../) after `npm.cmd ci`:

```powershell
npm.cmd test
npm.cmd run audit:app
npm.cmd run audit:regional
npm.cmd run audit:presets
npm.cmd run build
npm.cmd run check:delivery
```

The current commands cover 160 unit/regression tests, 8 application integration checks, 7 regional data/model checks, 8 preset data/model checks and 42 static-delivery checks. Their reports may be regenerated locally. The root [release manifest](../../RELEASE_MANIFEST.json) describes the packaged snapshot before any subsequent local regeneration.

## Retained browser and historical records

The original application 1.1.12 release includes 11 fresh preset-browser checks. Regional-browser evidence was captured on 1.1.11; older usability, layout, export and media checks have their own recorded scope. These records are preserved, not relabeled as fresh package-time executions.

Large historical release ZIPs and private working documents are intentionally absent. Preservation audits still check required engine/prepared-input bytes. Optional historical artifacts are verified when present, or explicitly marked **NOT_PRESENT** when absent. Absence is not a false preservation pass.

Current final media are distributed separately under [docs/demo](../../docs/demo/) with a dedicated public manifest. Their newer versions do not overwrite old release-reference files or expected hashes.

Public package 1.1 removes non-rendered production metadata from the regional SVG. Its dependent image hash and build cache keys therefore differ from earlier releases. The preset preservation record explicitly retains the two original hashes and the revised hashes; the audit checks unchanged SVG content outside metadata and unchanged regional definitions apart from the image hash. Older browser exports retain their recorded historical hashes rather than being presented as fresh outputs.

The original records may include the older technical label **Decision Model Lab**. It refers to the same engine's technical validation interface, not a second application.
