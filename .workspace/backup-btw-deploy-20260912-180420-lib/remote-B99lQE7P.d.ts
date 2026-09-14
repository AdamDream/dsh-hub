import { z } from "zod";
//#region src/shared/remote.d.ts
declare const sideChatErrorCodeSchema: z.ZodEnum<{
  "parent-not-found": "parent-not-found";
  "already-open": "already-open";
  "not-open": "not-open";
  "invalid-input": "invalid-input";
  compatibility: "compatibility";
  cancelled: "cancelled";
  internal: "internal";
}>;
type SideChatErrorCode = z.infer<typeof sideChatErrorCodeSchema>;
declare const sideChatErrorSchema: z.ZodObject<{
  code: z.ZodEnum<{
    "parent-not-found": "parent-not-found";
    "already-open": "already-open";
    "not-open": "not-open";
    "invalid-input": "invalid-input";
    compatibility: "compatibility";
    cancelled: "cancelled";
    internal: "internal";
  }>;
  message: z.ZodString;
}, z.core.$strict>;
type SideChatError = z.infer<typeof sideChatErrorSchema>;
/** The three models a side conversation may route to (provider is always `adam`). */
declare const btwModelSchema: z.ZodEnum<{
  "deepseek-v4-flash": "deepseek-v4-flash";
  "glm-5.3": "glm-5.3";
  "deepseek-v4-pro": "deepseek-v4-pro";
}>;
type BtwModel = z.infer<typeof btwModelSchema>;
declare const startSideChatRequestSchema: z.ZodObject<{
  parentSessionId: z.ZodString;
  chatToken: z.ZodString;
  model: z.ZodOptional<z.ZodEnum<{
    "deepseek-v4-flash": "deepseek-v4-flash";
    "glm-5.3": "glm-5.3";
    "deepseek-v4-pro": "deepseek-v4-pro";
  }>>;
}, z.core.$strict>;
type StartSideChatRequest = z.infer<typeof startSideChatRequestSchema>;
declare const startSideChatValueSchema: z.ZodObject<{
  parentSessionId: z.ZodString;
  childSessionId: z.ZodString;
  chatToken: z.ZodString;
  seedLength: z.ZodNumber;
  resumed: z.ZodBoolean;
  model: z.ZodOptional<z.ZodEnum<{
    "deepseek-v4-flash": "deepseek-v4-flash";
    "glm-5.3": "glm-5.3";
    "deepseek-v4-pro": "deepseek-v4-pro";
  }>>;
}, z.core.$strict>;
type StartSideChatValue = z.infer<typeof startSideChatValueSchema>;
declare const startSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    parentSessionId: z.ZodString;
    childSessionId: z.ZodString;
    chatToken: z.ZodString;
    seedLength: z.ZodNumber;
    resumed: z.ZodBoolean;
    model: z.ZodOptional<z.ZodEnum<{
      "deepseek-v4-flash": "deepseek-v4-flash";
      "glm-5.3": "glm-5.3";
      "deepseek-v4-pro": "deepseek-v4-pro";
    }>>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type StartSideChatResult = z.infer<typeof startSideChatResultSchema>;
declare const readSideChatRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
}, z.core.$strict>;
type ReadSideChatRequest = z.infer<typeof readSideChatRequestSchema>;
/** The raster formats a pasted side-chat image may carry (aligned with `dsh-attachment`). */
declare const sideChatImageMediaTypeSchema: z.ZodEnum<{
  "image/png": "image/png";
  "image/jpeg": "image/jpeg";
  "image/webp": "image/webp";
  "image/gif": "image/gif";
}>;
type SideChatImageMediaType = z.infer<typeof sideChatImageMediaTypeSchema>;
/**
 * One pasted image carried by a `sideChat/send` request. `data` is the
 * canonical base64 payload; the host admits it through the attachments store
 * before it is ever referenced.
 */
declare const sideChatImagePartSchema: z.ZodObject<{
  type: z.ZodLiteral<"image">;
  mediaType: z.ZodEnum<{
    "image/png": "image/png";
    "image/jpeg": "image/jpeg";
    "image/webp": "image/webp";
    "image/gif": "image/gif";
  }>;
  data: z.ZodString;
  name: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type SideChatImagePart = z.infer<typeof sideChatImagePartSchema>;
/** A durable image reference echoed in the transcript for display (host-owned refs). */
declare const sideChatImageRefSchema: z.ZodObject<{
  attachmentId: z.ZodString;
  mediaType: z.ZodEnum<{
    "image/png": "image/png";
    "image/jpeg": "image/jpeg";
    "image/webp": "image/webp";
    "image/gif": "image/gif";
  }>;
  name: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type SideChatImageRef = z.infer<typeof sideChatImageRefSchema>;
declare const sideChatTranscriptMessageSchema: z.ZodObject<{
  id: z.ZodString;
  role: z.ZodEnum<{
    user: "user";
    assistant: "assistant";
  }>;
  text: z.ZodString;
  images: z.ZodOptional<z.ZodArray<z.ZodObject<{
    attachmentId: z.ZodString;
    mediaType: z.ZodEnum<{
      "image/png": "image/png";
      "image/jpeg": "image/jpeg";
      "image/webp": "image/webp";
      "image/gif": "image/gif";
    }>;
    name: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>>;
}, z.core.$strict>;
type SideChatTranscriptMessage = z.infer<typeof sideChatTranscriptMessageSchema>;
declare const readSideChatImageRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
  attachmentId: z.ZodString;
}, z.core.$strict>;
type ReadSideChatImageRequest = z.infer<typeof readSideChatImageRequestSchema>;
declare const readSideChatImageResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    mediaType: z.ZodEnum<{
      "image/png": "image/png";
      "image/jpeg": "image/jpeg";
      "image/webp": "image/webp";
      "image/gif": "image/gif";
    }>;
    data: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type ReadSideChatImageResult = z.infer<typeof readSideChatImageResultSchema>;
/** One question inside a pending btw_ask_user call (mirrors ask_user_question's shape). */
declare const btwQuestionSchema: z.ZodObject<{
  id: z.ZodString;
  question: z.ZodString;
  header: z.ZodOptional<z.ZodString>;
  options: z.ZodOptional<z.ZodArray<z.ZodObject<{
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>>;
  multi_select: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
type BtwQuestion = z.infer<typeof btwQuestionSchema>;
/** The question currently blocking the child agent, surfaced through sideChat/read. */
declare const btwPendingQuestionSchema: z.ZodObject<{
  questionId: z.ZodString;
  questions: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    question: z.ZodString;
    header: z.ZodOptional<z.ZodString>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
      label: z.ZodString;
      description: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    multi_select: z.ZodOptional<z.ZodBoolean>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type BtwPendingQuestion = z.infer<typeof btwPendingQuestionSchema>;
/** One answered question, echoed back through sideChat/answer. */
declare const btwAnswerSchema: z.ZodObject<{
  id: z.ZodString;
  selected: z.ZodArray<z.ZodString>;
  custom: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type BtwAnswer = z.infer<typeof btwAnswerSchema>;
declare const readSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    revision: z.ZodNumber;
    messages: z.ZodArray<z.ZodObject<{
      id: z.ZodString;
      role: z.ZodEnum<{
        user: "user";
        assistant: "assistant";
      }>;
      text: z.ZodString;
      images: z.ZodOptional<z.ZodArray<z.ZodObject<{
        attachmentId: z.ZodString;
        mediaType: z.ZodEnum<{
          "image/png": "image/png";
          "image/jpeg": "image/jpeg";
          "image/webp": "image/webp";
          "image/gif": "image/gif";
        }>;
        name: z.ZodOptional<z.ZodString>;
      }, z.core.$strict>>>;
    }, z.core.$strict>>;
    partial: z.ZodString;
    reasoning: z.ZodString;
    running: z.ZodBoolean;
    runningTool: z.ZodOptional<z.ZodString>;
    pendingQuestion: z.ZodOptional<z.ZodObject<{
      questionId: z.ZodString;
      questions: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        question: z.ZodString;
        header: z.ZodOptional<z.ZodString>;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
          label: z.ZodString;
          description: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        multi_select: z.ZodOptional<z.ZodBoolean>;
      }, z.core.$strict>>;
    }, z.core.$strict>>;
    model: z.ZodOptional<z.ZodEnum<{
      "deepseek-v4-flash": "deepseek-v4-flash";
      "glm-5.3": "glm-5.3";
      "deepseek-v4-pro": "deepseek-v4-pro";
    }>>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type ReadSideChatResult = z.infer<typeof readSideChatResultSchema>;
declare const sendSideChatRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
  requestId: z.ZodString;
  text: z.ZodString;
  images: z.ZodOptional<z.ZodArray<z.ZodObject<{
    type: z.ZodLiteral<"image">;
    mediaType: z.ZodEnum<{
      "image/png": "image/png";
      "image/jpeg": "image/jpeg";
      "image/webp": "image/webp";
      "image/gif": "image/gif";
    }>;
    data: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>>;
}, z.core.$strict>;
type SendSideChatRequest = z.infer<typeof sendSideChatRequestSchema>;
declare const sendSideChatValueSchema: z.ZodObject<{
  chatToken: z.ZodString;
  requestId: z.ZodString;
  accepted: z.ZodLiteral<true>;
  messageId: z.ZodString;
}, z.core.$strict>;
type SendSideChatValue = z.infer<typeof sendSideChatValueSchema>;
declare const sendSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    requestId: z.ZodString;
    accepted: z.ZodLiteral<true>;
    messageId: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type SendSideChatResult = z.infer<typeof sendSideChatResultSchema>;
declare const cancelSideChatRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
}, z.core.$strict>;
type CancelSideChatRequest = z.infer<typeof cancelSideChatRequestSchema>;
declare const cancelSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    accepted: z.ZodLiteral<true>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type CancelSideChatResult = z.infer<typeof cancelSideChatResultSchema>;
declare const answerSideChatRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
  questionId: z.ZodString;
  answers: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    selected: z.ZodArray<z.ZodString>;
    custom: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type AnswerSideChatRequest = z.infer<typeof answerSideChatRequestSchema>;
declare const answerSideChatValueSchema: z.ZodObject<{
  chatToken: z.ZodString;
  questionId: z.ZodString;
  accepted: z.ZodLiteral<true>;
}, z.core.$strict>;
type AnswerSideChatValue = z.infer<typeof answerSideChatValueSchema>;
declare const answerSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    questionId: z.ZodString;
    accepted: z.ZodLiteral<true>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type AnswerSideChatResult = z.infer<typeof answerSideChatResultSchema>;
declare const closeSideChatRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
}, z.core.$strict>;
type CloseSideChatRequest = z.infer<typeof closeSideChatRequestSchema>;
declare const closeSideChatValueSchema: z.ZodObject<{
  chatToken: z.ZodString;
  closed: z.ZodBoolean;
  cleanup: z.ZodEnum<{
    kept: "kept";
    absent: "absent";
  }>;
  warning: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
type CloseSideChatValue = z.infer<typeof closeSideChatValueSchema>;
declare const closeSideChatResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    closed: z.ZodBoolean;
    cleanup: z.ZodEnum<{
      kept: "kept";
      absent: "absent";
    }>;
    warning: z.ZodOptional<z.ZodString>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type CloseSideChatResult = z.infer<typeof closeSideChatResultSchema>;
declare const setSideChatModelRequestSchema: z.ZodObject<{
  chatToken: z.ZodString;
  model: z.ZodEnum<{
    "deepseek-v4-flash": "deepseek-v4-flash";
    "glm-5.3": "glm-5.3";
    "deepseek-v4-pro": "deepseek-v4-pro";
  }>;
}, z.core.$strict>;
type SetSideChatModelRequest = z.infer<typeof setSideChatModelRequestSchema>;
declare const setSideChatModelValueSchema: z.ZodObject<{
  chatToken: z.ZodString;
  accepted: z.ZodLiteral<true>;
}, z.core.$strict>;
type SetSideChatModelValue = z.infer<typeof setSideChatModelValueSchema>;
declare const setSideChatModelResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    chatToken: z.ZodString;
    accepted: z.ZodLiteral<true>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type SetSideChatModelResult = z.infer<typeof setSideChatModelResultSchema>;
/**
 * One enumerated side conversation: a tree/project node (identified by
 * `parentSessionId`) joined with its persisted btw index record and, when the
 * node is live, fresh session metadata.
 */
declare const sideChatTreeEntrySchema: z.ZodObject<{
  parentSessionId: z.ZodString;
  childSessionId: z.ZodString;
  title: z.ZodOptional<z.ZodString>;
  cwd: z.ZodOptional<z.ZodString>;
  lastActiveAt: z.ZodNumber;
  preview: z.ZodOptional<z.ZodString>;
  running: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
type SideChatTreeEntry = z.infer<typeof sideChatTreeEntrySchema>;
declare const listSideChatTreeRequestSchema: z.ZodObject<{
  parentSessionId: z.ZodString;
}, z.core.$strict>;
type ListSideChatTreeRequest = z.infer<typeof listSideChatTreeRequestSchema>;
declare const listSideChatTreeResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
      parentSessionId: z.ZodString;
      childSessionId: z.ZodString;
      title: z.ZodOptional<z.ZodString>;
      cwd: z.ZodOptional<z.ZodString>;
      lastActiveAt: z.ZodNumber;
      preview: z.ZodOptional<z.ZodString>;
      running: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type ListSideChatTreeResult = z.infer<typeof listSideChatTreeResultSchema>;
declare const listSideChatProjectRequestSchema: z.ZodObject<{
  parentSessionId: z.ZodString;
}, z.core.$strict>;
type ListSideChatProjectRequest = z.infer<typeof listSideChatProjectRequestSchema>;
declare const listSideChatProjectResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
  ok: z.ZodLiteral<true>;
  value: z.ZodObject<{
    entries: z.ZodArray<z.ZodObject<{
      parentSessionId: z.ZodString;
      childSessionId: z.ZodString;
      title: z.ZodOptional<z.ZodString>;
      cwd: z.ZodOptional<z.ZodString>;
      lastActiveAt: z.ZodNumber;
      preview: z.ZodOptional<z.ZodString>;
      running: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
  }, z.core.$strict>;
}, z.core.$strict>, z.ZodObject<{
  ok: z.ZodLiteral<false>;
  error: z.ZodObject<{
    code: z.ZodEnum<{
      "parent-not-found": "parent-not-found";
      "already-open": "already-open";
      "not-open": "not-open";
      "invalid-input": "invalid-input";
      compatibility: "compatibility";
      cancelled: "cancelled";
      internal: "internal";
    }>;
    message: z.ZodString;
  }, z.core.$strict>;
}, z.core.$strict>], "ok">;
type ListSideChatProjectResult = z.infer<typeof listSideChatProjectResultSchema>;
//#endregion
export { readSideChatImageRequestSchema as $, SideChatImagePart as A, btwAnswerSchema as B, SendSideChatValue as C, SideChatError as D, SetSideChatModelValue as E, StartSideChatResult as F, cancelSideChatResultSchema as G, btwPendingQuestionSchema as H, StartSideChatValue as I, closeSideChatValueSchema as J, closeSideChatRequestSchema as K, answerSideChatRequestSchema as L, SideChatTranscriptMessage as M, SideChatTreeEntry as N, SideChatErrorCode as O, StartSideChatRequest as P, listSideChatTreeResultSchema as Q, answerSideChatResultSchema as R, SendSideChatResult as S, SetSideChatModelResult as T, btwQuestionSchema as U, btwModelSchema as V, cancelSideChatRequestSchema as W, listSideChatProjectResultSchema as X, listSideChatProjectRequestSchema as Y, listSideChatTreeRequestSchema as Z, ReadSideChatImageRequest as _, startSideChatResultSchema as _t, BtwModel as a, sendSideChatValueSchema as at, ReadSideChatResult as b, CancelSideChatRequest as c, setSideChatModelValueSchema as ct, CloseSideChatResult as d, sideChatImageMediaTypeSchema as dt, readSideChatImageResultSchema as et, CloseSideChatValue as f, sideChatImagePartSchema as ft, ListSideChatTreeResult as g, startSideChatRequestSchema as gt, ListSideChatTreeRequest as h, sideChatTreeEntrySchema as ht, BtwAnswer as i, sendSideChatResultSchema as it, SideChatImageRef as j, SideChatImageMediaType as k, CancelSideChatResult as l, sideChatErrorCodeSchema as lt, ListSideChatProjectResult as m, sideChatTranscriptMessageSchema as mt, AnswerSideChatResult as n, readSideChatResultSchema as nt, BtwPendingQuestion as o, setSideChatModelRequestSchema as ot, ListSideChatProjectRequest as p, sideChatImageRefSchema as pt, closeSideChatResultSchema as q, AnswerSideChatValue as r, sendSideChatRequestSchema as rt, BtwQuestion as s, setSideChatModelResultSchema as st, AnswerSideChatRequest as t, readSideChatRequestSchema as tt, CloseSideChatRequest as u, sideChatErrorSchema as ut, ReadSideChatImageResult as v, startSideChatValueSchema as vt, SetSideChatModelRequest as w, SendSideChatRequest as x, ReadSideChatRequest as y, answerSideChatValueSchema as z };