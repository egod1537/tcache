# Tokyo OTP transfer quality tools

These tools build a reviewed, cross-feed station-complex evidence layer and
exercise transfers against a running OTP instance. They do not consolidate OTP
stops and do not write synthetic transfers into the source GTFS feeds.

```sh
pnpm --filter @tcache/otp-transfer-tools build-map -- \
  --build-root otp/data/japan/tokyo/builds/latest \
  --review-config otp/config/station-complex-review.json

pnpm --filter @tcache/otp-transfer-tools regression -- \
  --build-root otp/data/japan/tokyo/builds/latest \
  --base-url http://localhost:18082 \
  --cases otp/config/transfer-regression-suite.json \
  --query otp/queries/plan-tokyo.graphql

pnpm --filter @tcache/otp-transfer-tools validate-walks -- \
  --build-root otp/data/japan/tokyo/builds/latest \
  --base-url http://localhost:18082 \
  --query otp/queries/walk-station-complex.graphql

pnpm --filter @tcache/otp-transfer-tools report -- \
  --build-root otp/data/japan/tokyo/builds/latest
```

The output is written to `diagnostics/transfers/` in the selected immutable
build. Explicit transfer rules are emitted only as reviewed decisions. A
decision with `action: "USE_OSM_PATH"` documents that OTP's pedestrian graph is
authoritative; it is not an instruction to create a zero-time transfer.
