/*
 * Minimal stand-in for @deepseek-ai/dsh-client-ui-primitives.
 * The deployed profile resolves that package only inside the web app bundle, so
 * the audit supplies an equivalent surface: Button (real <button>), Modal, and
 * the concrete icons the settings bundles reference. Component shape only —
 * no behaviour that matters to the measurement.
 */
'use strict';
const { jsxRuntime } = require('./loader.cjs');
const { jsx, jsxs } = jsxRuntime;

function icon(size) {
  return function Icon(props) {
    return jsx('svg', {
      width: props.size ?? size,
      height: props.size ?? size,
      viewBox: '0 0 16 16',
      fill: 'none',
      'aria-hidden': true,
      children: jsx('path', { d: 'M2 2L14 14', stroke: 'currentColor', strokeWidth: 1.5 }),
    });
  };
}

function Button(props) {
  const { variant, size, className, children, ...rest } = props;
  return jsx('button', { ...rest, className, children });
}

function Modal(props) {
  if (props.open !== true) return null;
  const { open, onClose, title, footer, children, className, closeLabel, description, headless } = props;
  return jsxs('div', {
    className,
    role: 'dialog',
    children: [
      jsx('h2', { children: title }),
      description === undefined || description === '' ? null : jsx('p', { children: description }),
      children,
      footer ?? null,
    ],
  });
}

module.exports = {
  Button,
  Modal,
  IconPlusOutline16: icon(16),
  IconTrashOutline16: icon(16),
  IconChevronDownOutline14: icon(14),
  IconChevronRightOutline14: icon(14),
  IconSearchOutline16: icon(16),
  IconDataOutline16: icon(16),
  IconSettingsOutline16: icon(16),
  IconCloseOutline16: icon(16),
  IconAgentPresetOutline16: icon(16),
  IconPersonalizationOutline16: icon(16),
};
