import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

const MessageInput = ({ onSend, disabled, onTypingStart, onTypingStop }) => {
  const [text, setText] = useState('');
  const typingTimer = useRef(null);
  const typingActive = useRef(false);

  const notifyStop = () => {
    if (typingActive.current) {
      onTypingStop();
      typingActive.current = false;
    }
  };

  useEffect(() => {
    return () => {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
      }
      notifyStop();
    };
  }, []);

  const handleChange = (event) => {
    const value = event.target.value;
    setText(value);
    const hasText = value.trim().length > 0;

    if (hasText && !typingActive.current) {
      onTypingStart();
      typingActive.current = true;
    }

    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
    }

    typingTimer.current = setTimeout(() => {
      notifyStop();
    }, 1200);

    if (!hasText) {
      notifyStop();
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      notifyStop();
      setText('');
      return;
    }
    onSend(trimmed);
    setText('');
    notifyStop();
  };

  return (
    <form className="message-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={text}
        onChange={handleChange}
        placeholder="Введите сообщение"
        className="message-input"
        disabled={disabled}
      />
      <button type="submit" className="primary-btn" disabled={disabled}>
        Отправить
      </button>
    </form>
  );
};

MessageInput.propTypes = {
  onSend: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
  onTypingStart: PropTypes.func,
  onTypingStop: PropTypes.func,
};

MessageInput.defaultProps = {
  disabled: false,
  onTypingStart: () => {},
  onTypingStop: () => {},
};

export default MessageInput;
