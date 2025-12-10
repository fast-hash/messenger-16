import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { formatRole } from '../utils/roleLabels';

const UserPicker = ({ mode, users, selectedIds, onChange, excludeIds, placeholder }) => {
  const [search, setSearch] = useState('');
  const excluded = new Set(excludeIds);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((user) => {
      if (excluded.has(user.id)) return false;
      if (!term) return true;
      return [user.displayName, user.username, user.email].some((field) =>
        field?.toLowerCase().includes(term)
      );
    });
  }, [users, search, excluded]);

  const toggleUser = (userId) => {
    if (mode === 'single') {
      onChange([userId]);
      return;
    }
    const set = new Set(selectedIds);
    if (set.has(userId)) set.delete(userId);
    else set.add(userId);
    onChange(Array.from(set));
  };

  return (
    <div className="user-picker">
      <input
        type="text"
        className="field-input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
      />
      <div className="user-picker__list user-list-scroll">
        {filtered.map((user) => {
          const isSelected = selectedIds.includes(user.id);
          return (
            <button
              key={user.id}
              type="button"
              className={`user-card ${isSelected ? 'user-card--selected' : ''}`}
              onClick={() => toggleUser(user.id)}
            >
              {mode === 'multi' && (
                <input type="checkbox" readOnly checked={isSelected} className="user-card__checkbox" />
              )}
              <div className="user-card__body">
                <div className="user-card__title">{user.displayName || user.username}</div>
                <div className="user-card__meta">
                  {formatRole(user.role)} · {user.department || 'Отдел не указан'} · {user.email}
                </div>
              </div>
            </button>
          );
        })}
        {!filtered.length && <p className="muted">Ничего не найдено</p>}
      </div>
    </div>
  );
};

UserPicker.propTypes = {
  mode: PropTypes.oneOf(['single', 'multi']),
  users: PropTypes.arrayOf(PropTypes.object).isRequired,
  selectedIds: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
  excludeIds: PropTypes.arrayOf(PropTypes.string),
  placeholder: PropTypes.string,
};

UserPicker.defaultProps = {
  mode: 'single',
  selectedIds: [],
  excludeIds: [],
  placeholder: 'Поиск по имени, email или логину',
};

export default UserPicker;
