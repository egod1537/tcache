# JR East local timetable artifacts

This directory is reserved for licensed, local-only JR East timetable research artifacts. Generated contents are ignored by Git and must not be redistributed or used by a commercial service.

```text
raw/        immutable response bodies, named by SHA-256
manifests/  immutable per-request metadata, named by canonical manifest hash
parsed/     normalized datasets, named by canonical dataset hash
mappings/   local station-to-OSM review data
yamanote/   versioned normalized, GTFS, and validator outputs
```

The collector store deduplicates identical response bodies while retaining a separate request manifest for each distinct request. A parser reads a raw body plus its manifest and writes only to `parsed/`. Numeric keys from upstream URLs are provenance fields, not persistent internal IDs.

The reviewed Yamanote OSM mapping is versioned because it contains no timetable rows and carries explicit ODbL attribution. Collected HTML, normalized timetable rows, generated GTFS, and validator reports stay Git-ignored and local.

The common generator writes GTFS under `yamanote/<dataset-version>/gtfs/` and the official MobilityData report under `validator/`. This does not integrate the feed into the existing OTP graph; graph building remains out of scope.
