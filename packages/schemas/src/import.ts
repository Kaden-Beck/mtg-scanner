import { z } from "zod";

/** Wire-shape contract for POST /api/import/archidekt (KAD-13). */
export const importArchidektRequestSchema = z.object({
  fileName: z.string().min(1),
  csvText: z.string(),
  duplicateAction: z.enum(["merge", "replace"]).optional(),
});
export type ImportArchidektRequest = z.infer<typeof importArchidektRequestSchema>;
