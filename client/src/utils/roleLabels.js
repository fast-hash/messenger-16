// Маппинг технических ролей пользователя на русские подписи для интерфейса
export const ROLE_LABELS = {
  doctor: 'Врач',
  nurse: 'Медсестра / медбрат',
  admin: 'Администратор',
  staff: 'Персонал',
};

export const ROLE_OPTIONS = [
  { value: 'doctor', label: ROLE_LABELS.doctor },
  { value: 'nurse', label: ROLE_LABELS.nurse },
  { value: 'admin', label: ROLE_LABELS.admin },
  { value: 'staff', label: ROLE_LABELS.staff },
];

export const formatRole = (role) => ROLE_LABELS[role] || role || 'Персонал';
