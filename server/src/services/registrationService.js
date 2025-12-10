const bcrypt = require('bcryptjs');
const RegistrationRequest = require('../models/RegistrationRequest');
const userService = require('./userService');

const SALT_ROUNDS = 10;
const ALLOWED_ROLES = ['doctor', 'nurse', 'admin', 'staff'];
const normalizeRole = (role) => (ALLOWED_ROLES.includes(role) ? role : 'staff');

const toRequestDto = (doc) => ({
  id: doc._id.toString(),
  username: doc.username,
  email: doc.email,
  displayName: doc.displayName,
  role: doc.role,
  department: doc.department,
  jobTitle: doc.jobTitle,
  createdAt: doc.createdAt,
});

const validateUniqueAcrossCollections = async ({ username, email }) => {
  const normalizedEmail = (email || '').toLowerCase();

  const [existingRequestEmail, existingRequestUsername] = await Promise.all([
    RegistrationRequest.findOne({ email: normalizedEmail }),
    RegistrationRequest.findOne({ username }),
  ]);

  if (existingRequestEmail) {
    const error = new Error('Email is already pending approval');
    error.status = 409;
    throw error;
  }

  if (existingRequestUsername) {
    const error = new Error('Username is already pending approval');
    error.status = 409;
    throw error;
  }

  await userService.ensureUniqueUser({ username, email: normalizedEmail });
};

const createRegistrationRequest = async ({
  username,
  email,
  password,
  displayName,
  role,
  department,
  jobTitle,
}) => {
  if (!username || !email || !password) {
    const error = new Error('Username, email, and password are required');
    error.status = 400;
    throw error;
  }

  const normalizedEmail = email.toLowerCase();
  await validateUniqueAcrossCollections({ username, email: normalizedEmail });

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const request = await RegistrationRequest.create({
    username,
    email: normalizedEmail,
    passwordHash,
    displayName: displayName || username,
    role: normalizeRole(role),
    department: department || null,
    jobTitle: jobTitle || null,
  });

  return toRequestDto(request);
};

const listRequests = async () => {
  const requests = await RegistrationRequest.find().sort({ createdAt: -1 });
  return requests.map(toRequestDto);
};

const approveRequest = async ({ requestId }) => {
  const request = await RegistrationRequest.findById(requestId);
  if (!request) {
    const error = new Error('Registration request not found');
    error.status = 404;
    throw error;
  }

  await userService.ensureUniqueUser({ username: request.username, email: request.email });

  const user = await userService.createUser({
    username: request.username,
    email: request.email,
    passwordHash: request.passwordHash,
    displayName: request.displayName,
    role: request.role,
    department: request.department,
    jobTitle: request.jobTitle,
  });

  await request.deleteOne();

  return user;
};

const rejectRequest = async ({ requestId }) => {
  const request = await RegistrationRequest.findById(requestId);
  if (!request) {
    const error = new Error('Registration request not found');
    error.status = 404;
    throw error;
  }

  await request.deleteOne();
};

module.exports = {
  createRegistrationRequest,
  listRequests,
  approveRequest,
  rejectRequest,
};
