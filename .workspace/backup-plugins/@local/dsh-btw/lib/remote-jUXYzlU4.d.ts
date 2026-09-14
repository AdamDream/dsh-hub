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
declare const sideChatTranscriptMessageSchema: z.ZodObject<{
  id: z.ZodString;
  role: z.ZodEnum<{
    user: "user";
    assistant: "assistant";
  }>;
  text: z.ZodString;
}, z.core.$strict>;
type SideChatTranscriptMessage = z.infer<typeof sideChatTranscriptMessageSchema>;
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
//#endregion
export { btwAnswerSchema as A, readSideChatResultSchema as B, SideChatTranscriptMessage as C, answerSideChatRequestSchema as D, StartSideChatValue as E, cancelSideChatResultSchema as F, setSideChatModelResultSchema as G, sendSideChatResultSchema as H, closeSideChatRequestSchema as I, sideChatErrorSchema as J, setSideChatModelValueSchema as K, closeSideChatResultSchema as L, btwPendingQuestionSchema as M, btwQuestionSchema as N, answerSideChatResultSchema as O, cancelSideChatRequestSchema as P, startSideChatValueSchema as Q, closeSideChatValueSchema as R, SideChatErrorCode as S, StartSideChatResult as T, sendSideChatValueSchema as U, sendSideChatRequestSchema as V, setSideChatModelRequestSchema as W, startSideChatRequestSchema as X, sideChatTranscriptMessageSchema as Y, startSideChatResultSchema as Z, SendSideChatValue as _, BtwModel as a, SetSideChatModelValue as b, CancelSideChatRequest as c, CloseSideChatResult as d, CloseSideChatValue as f, SendSideChatResult as g, SendSideChatRequest as h, BtwAnswer as i, btwModelSchema as j, answerSideChatValueSchema as k, CancelSideChatResult as l, ReadSideChatResult as m, AnswerSideChatResult as n, BtwPendingQuestion as o, ReadSideChatRequest as p, sideChatErrorCodeSchema as q, AnswerSideChatValue as r, BtwQuestion as s, AnswerSideChatRequest as t, CloseSideChatRequest as u, SetSideChatModelRequest as v, StartSideChatRequest as w, SideChatError as x, SetSideChatModelResult as y, readSideChatRequestSchema as z };