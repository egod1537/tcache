import type {
  ConflictRecord,
  DetailTripCandidate,
  MatrixTripCandidate,
} from './model.js';

export interface ReconciliationResult {
  candidates: MatrixTripCandidate[];
  conflicts: ConflictRecord[];
}

export function reconcileMatrixWithDetails(
  matrixCandidates: MatrixTripCandidate[],
  detailCandidates: DetailTripCandidate[],
): ReconciliationResult {
  const conflicts: ConflictRecord[] = [];
  const candidates = matrixCandidates.map((matrix) => {
    const matches = detailCandidates.filter(
      (detail) =>
        detail.trainNumber === matrix.trainNumber &&
        (detail.direction === undefined ||
          detail.direction === matrix.direction) &&
        (detail.service === undefined || detail.service === matrix.service),
    );
    if (matches.length === 0) return matrix;
    if (matches.length > 1) {
      conflicts.push({
        code: 'AMBIGUOUS_DETAIL_MATCH',
        trainNumber: matrix.trainNumber,
        direction: matrix.direction,
        service: matrix.service,
        matrixSourceUrl: matrix.sourceReference.sourceUrl,
        detailSourceUrl: matches[0]?.sourceReference.sourceUrl ?? '',
        differences: [
          `${matches.length} detail candidates share this train number`,
        ],
      });
      return matrix;
    }

    const detail = matches[0]!;
    const differences = compareStops(matrix, detail);
    if (differences.length > 0) {
      conflicts.push({
        code: 'MATRIX_DETAIL_CONFLICT',
        trainNumber: matrix.trainNumber,
        direction: matrix.direction,
        service: matrix.service,
        matrixSourceUrl: matrix.sourceReference.sourceUrl,
        detailSourceUrl: detail.sourceReference.sourceUrl,
        differences,
      });
      return matrix;
    }

    return {
      ...matrix,
      trainType: detail.trainType,
      operationCondition: [
        matrix.operationCondition,
        ...detail.operationConditions,
      ]
        .filter(Boolean)
        .join('; '),
      stops: detail.stops.map((stop) => ({
        ...stop,
        sourceReference: detail.sourceReference,
      })),
    };
  });
  return { candidates, conflicts };
}

function compareStops(
  matrix: MatrixTripCandidate,
  detail: DetailTripCandidate,
): string[] {
  const differences: string[] = [];
  if (matrix.stops.length !== detail.stops.length) {
    differences.push(
      `stop count differs: matrix=${matrix.stops.length}, detail=${detail.stops.length}`,
    );
    return differences;
  }
  matrix.stops.forEach((matrixStop, index) => {
    const detailStop = detail.stops[index];
    if (detailStop?.stationNameJa !== matrixStop.stationNameJa) {
      differences.push(
        `stop ${index} differs: matrix=${matrixStop.stationNameJa}, detail=${detailStop?.stationNameJa ?? '(missing)'}`,
      );
      return;
    }
    for (const event of ['arrival', 'departure'] as const) {
      const matrixValue = matrixStop[event];
      const detailValue = detailStop[event];
      if (JSON.stringify(matrixValue) !== JSON.stringify(detailValue)) {
        differences.push(
          `${matrixStop.stationNameJa} ${event} differs: matrix=${JSON.stringify(matrixValue)}, detail=${JSON.stringify(detailValue)}`,
        );
      }
    }
  });
  return differences;
}
