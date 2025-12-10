import { useState } from 'react';
import PropTypes from 'prop-types';

const ConfirmDialog = ({ text, onConfirm, onCancel }) => {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } catch (error) {
      console.error('Ошибка подтверждения', error);
      // eslint-disable-next-line no-alert
      alert('Не удалось выполнить действие. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
      onCancel();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3>Подтверждение</h3>
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Закрыть
          </button>
        </div>
        <p>{text}</p>
        <div className="choice-buttons">
          <button type="button" className="primary-btn" onClick={handleConfirm} disabled={submitting}>
            Да
          </button>
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={submitting}>
            Нет
          </button>
        </div>
      </div>
    </div>
  );
};

ConfirmDialog.propTypes = {
  text: PropTypes.string.isRequired,
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default ConfirmDialog;
