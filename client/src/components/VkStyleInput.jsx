import React, { useMemo, useRef } from 'react';
import PropTypes from 'prop-types';

const VkStyleInput = ({ value, onChange, onSend, disabled, onAttach }) => {
  const hasText = useMemo(() => value.trim().length > 0, [value]);
  const attachWrapperRef = useRef(null);

  const handleSubmit = () => {
    if (!hasText) return;
    onSend();
  };

  const handleAttachClick = () => {
    if (disabled) return;
    onAttach?.();
  };

  return (
    <div className="vk-input">
      <div className="vk-input__attach-wrapper" ref={attachWrapperRef}>
        <button
          type="button"
          className="vk-input__circle-btn vk-input__attach"
          disabled={disabled}
          onClick={handleAttachClick}
          title="Прикрепить файл"
        >
          <span className="vk-input__plus">+</span>
        </button>
      </div>

      <textarea
        className="vk-input__textarea"
        rows={1}
        placeholder="Введите сообщение"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
        }}
      />

      <div className="vk-input__send-wrapper">
        <button
          type="button"
          className={`vk-input__circle-btn vk-input__send${hasText ? ' vk-input__send--active' : ''}`}
          disabled={!hasText || disabled}
          onClick={handleSubmit}
        >
          <svg className="vk-input__send-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20L20 12L4 4V10L14 12L4 14V20Z" />
          </svg>
        </button>
      </div>
    </div>
  );
};

VkStyleInput.propTypes = {
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  onSend: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  onAttach: PropTypes.func,
};

VkStyleInput.defaultProps = {
  disabled: false,
  onAttach: undefined,
};

export default VkStyleInput;
