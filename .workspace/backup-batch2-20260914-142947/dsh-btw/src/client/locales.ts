export const NS = 'btw' as const

export type SideChatLocaleKey =
  | 'button.open' | 'button.close' | 'drawer.title' | 'drawer.subtitle' | 'drawer.readOnly'
  | 'drawer.mainRunning' | 'drawer.mainReady' | 'drawer.emptyTitle'
  | 'drawer.emptyBody' | 'drawer.placeholder' | 'drawer.send' | 'drawer.stop' | 'drawer.retry'
  | 'drawer.close' | 'drawer.discard' | 'drawer.you' | 'drawer.assistant' | 'drawer.thinking'
  | 'drawer.contextNote' | 'drawer.error'
  | 'drawer.questionTitle' | 'drawer.questionCustom' | 'drawer.questionCustomPlaceholder'
  | 'drawer.answer' | 'drawer.answering' | 'drawer.multiHint'
  | 'drawer.shortcut' | 'drawer.minimize' | 'drawer.end' | 'drawer.endTitle'
  | 'drawer.endBody' | 'drawer.endCancel' | 'drawer.endConfirm' | 'drawer.ending'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'btw': SideChatLocaleKey }
}

export const en: Record<SideChatLocaleKey, string> = {
  'button.open': 'Open btw', 'button.close': 'Close btw',
  'drawer.title': 'btw', 'drawer.subtitle': 'Ask aside. Stay on track.', 'drawer.readOnly': 'READ ONLY',
  'drawer.mainRunning': 'Main task running', 'drawer.mainReady': 'Main task ready',
  'drawer.emptyTitle': 'Ask without drifting',
  'drawer.emptyBody': 'This side conversation can read the main context, but cannot change files or external state. It is kept across tasks and restarts.',
  'drawer.placeholder': 'Ask a side question…', 'drawer.send': 'Send', 'drawer.stop': 'Stop', 'drawer.retry': 'Try again',
  'drawer.close': 'Close btw', 'drawer.discard': 'Kept across tasks and restarts', 'drawer.you': 'You',
  'drawer.assistant': 'Side assistant',
  'drawer.thinking': 'Thinking',
  'drawer.contextNote': 'Inherited context is reference-only. The main conversation stays untouched.',
  'drawer.error': 'btw could not open',
  'drawer.questionTitle': 'The side assistant is asking you',
  'drawer.questionCustom': 'Custom answer',
  'drawer.questionCustomPlaceholder': 'Type your own answer…',
  'drawer.answer': 'Send answer', 'drawer.answering': 'Sending…', 'drawer.multiHint': 'You may pick several',
  'drawer.shortcut': '⌘⇧.',
  'drawer.minimize': 'Minimize btw', 'drawer.end': 'End btw',
  'drawer.endTitle': 'End btw?',
  'drawer.endBody': 'Ending closes this panel and stops the side assistant. Its saved history stays on disk and reopening resumes it. The main conversation is not affected.',
  'drawer.endCancel': 'Cancel', 'drawer.endConfirm': 'End', 'drawer.ending': 'Ending…',
}

export const zh: Record<SideChatLocaleKey, string> = {
  'button.open': '打开 btw', 'button.close': '关闭 btw',
  'drawer.title': 'btw 侧聊', 'drawer.subtitle': '临时问一句，主任务不跑偏。', 'drawer.readOnly': '只读',
  'drawer.mainRunning': '主任务运行中', 'drawer.mainReady': '主任务已就绪',
  'drawer.emptyTitle': '放心追问，不污染主线',
  'drawer.emptyBody': '这个侧边对话可读取主会话上下文，但不能修改文件或外部状态；内容跨任务、跨重启保留。',
  'drawer.placeholder': '输入一个临时问题…', 'drawer.send': '发送', 'drawer.stop': '停止', 'drawer.retry': '重试',
  'drawer.close': '关闭 btw', 'drawer.discard': '跨任务、跨重启保留', 'drawer.you': '你',
  'drawer.assistant': '侧边助手',
  'drawer.thinking': '思考中',
  'drawer.contextNote': '继承内容仅作参考，主会话不会被写入这段追问。',
  'drawer.error': 'btw 无法打开',
  'drawer.questionTitle': '侧边助手正在向你提问',
  'drawer.questionCustom': '自定义回答',
  'drawer.questionCustomPlaceholder': '输入你自己的回答…',
  'drawer.answer': '发送回答', 'drawer.answering': '发送中…', 'drawer.multiHint': '可多选',
  'drawer.shortcut': '⌘⇧.',
  'drawer.minimize': '收起 btw', 'drawer.end': '结束 btw',
  'drawer.endTitle': '结束 btw？',
  'drawer.endBody': '结束后会关闭本面板并停止侧边助手；已保存的历史仍在磁盘上，重新打开即可恢复。主会话不受影响。',
  'drawer.endCancel': '取消', 'drawer.endConfirm': '结束', 'drawer.ending': '正在结束…',
}
