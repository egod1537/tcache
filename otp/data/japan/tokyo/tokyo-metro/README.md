# Tokyo Metro local artifacts

This directory stores immutable official Tokyo Metro GTFS downloads for the
local Tokyo OTP proof of concept. Run `otp/scripts/fetch-tokyo-metro.sh` with
`TOKYO_METRO_ODPT_KEY` set; credentials are never written to artifacts or
manifests.

The data are for personal education and research in this repository. Do not
redistribute the downloaded feed or use it commercially. Follow the Public
Transportation Open Data Center terms and attribution requirements.

Artifact layout:

```text
<feed-version>/<sha256>/
  raw/TokyoMetro-Train-GTFS.zip
  tokyo-metro-feed-metadata.json
```
