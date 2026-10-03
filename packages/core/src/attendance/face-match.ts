/**
 * FaceMatchScorer and liveness verification stub interface (P2-PUNCH-04)
 * Async liveness and face match scoring interface.
 */

export interface FaceMatchResult {
  isMatch: boolean;
  confidence: number;
  livenessConfidence: number;
  flagged: boolean;
  details?: Record<string, unknown>;
}

export interface FaceMatchScorer {
  scoreSelfie(
    companyId: string,
    employeeId: string,
    selfieFileId: string,
  ): Promise<FaceMatchResult>;
}

/**
 * Default stub scorer. In real production, calls local ONNX model or edge inference.
 */
export class StubFaceMatchScorer implements FaceMatchScorer {
  async scoreSelfie(
    _companyId: string,
    _employeeId: string,
    _selfieFileId: string,
  ): Promise<FaceMatchResult> {
    return {
      isMatch: true,
      confidence: 0.98,
      livenessConfidence: 0.95,
      flagged: false,
    };
  }
}
