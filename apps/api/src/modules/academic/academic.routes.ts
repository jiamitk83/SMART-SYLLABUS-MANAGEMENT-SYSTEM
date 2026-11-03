import { Router } from 'express';
import type { Model } from 'mongoose';
import { authorize } from '../../middleware/auth.middleware';
import {
  AcademicSessionModel,
  ClassModel,
  SectionModel,
  SubjectModel,
  TeacherAssignmentModel,
} from '../../models/academic.models';
import { UserModel } from '../../models/auth.models';
import { asyncHandler, badRequest, notFound } from '../../utils/errors';
import { audit } from '../audit/audit.service';
import { createCrudRouter, idParam } from '../common/crud';
import { resolveSessionId } from '../common/integrity';
import {
  assignmentCreate,
  assignmentUpdate,
  classCreate,
  classUpdate,
  sectionCreate,
  sectionUpdate,
  sessionCreate,
  sessionUpdate,
  subjectCreate,
  subjectUpdate,
} from './academic.validation';

type M = Model<Record<string, unknown>>;
const asModel = (m: unknown): M => m as M;

async function ensureTeacher(id: unknown): Promise<void> {
  const t = await UserModel.findById(String(id)).lean();
  if (!t || t.role !== 'TEACHER' || !t.isActive) throw badRequest('Teacher not found or inactive');
}

export function academicRoutes(): Router {
  const r = Router();

  const sessions = createCrudRouter({
    entity: 'AcademicSession',
    model: asModel(AcademicSessionModel),
    read: 'academic:read',
    write: 'academic:manage',
    createSchema: sessionCreate,
    updateSchema: sessionUpdate,
    searchFields: ['name'],
    filterFields: ['isActive', 'isCurrent'],
    sort: { startDate: -1 },
    hooks: {
      async beforeActive(existing, isActive) {
        if (!isActive && existing.isCurrent) throw badRequest('The current academic session cannot be deactivated');
      },
      async beforeUpdate(data, existing) {
        const start = (data.startDate ?? existing.startDate) as Date;
        const end = (data.endDate ?? existing.endDate) as Date;
        if (end <= start) throw badRequest('End date must be after start date');
        return data;
      },
    },
  });
  sessions.post(
    '/:id/set-current',
    authorize('academic:manage'),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params).id;
      const target = await AcademicSessionModel.findById(id);
      if (!target) throw notFound();
      if (!target.isActive) throw badRequest('An inactive session cannot become current');
      // Only the flag moves; no historical record is touched.
      await AcademicSessionModel.updateMany({ isCurrent: true, _id: { $ne: id } }, { $set: { isCurrent: false } });
      target.isCurrent = true;
      await target.save();
      await audit(req, { action: 'CURRENT_SESSION_CHANGED', entityType: 'AcademicSession', entityId: id, academicSession: id });
      res.json({ data: target.toObject() });
    }),
  );
  r.use('/academic-sessions', sessions);

  r.use(
    '/classes',
    createCrudRouter({
      entity: 'Class',
      model: asModel(ClassModel),
      read: 'academic:read',
      write: 'academic:manage',
      createSchema: classCreate,
      updateSchema: classUpdate,
      searchFields: ['name'],
      filterFields: ['academicSession', 'isActive'],
      sort: { order: 1, name: 1 },
      bulk: true,
      hooks: {
        async beforeCreate(data) {
          return { ...data, academicSession: await resolveSessionId(data.academicSession) };
        },
      },
    }),
  );

  r.use(
    '/sections',
    createCrudRouter({
      entity: 'Section',
      model: asModel(SectionModel),
      read: 'academic:read',
      write: 'academic:manage',
      createSchema: sectionCreate,
      updateSchema: sectionUpdate,
      searchFields: ['name'],
      filterFields: ['academicSession', 'class', 'isActive'],
      populate: [{ path: 'class', select: 'name' }],
      sort: { name: 1 },
      bulk: true,
      hooks: {
        async beforeCreate(data) {
          const cls = await ClassModel.findById(String(data.class)).lean();
          if (!cls) throw badRequest('Class not found');
          return { ...data, academicSession: cls.academicSession };
        },
      },
    }),
  );

  r.use(
    '/subjects',
    createCrudRouter({
      entity: 'Subject',
      model: asModel(SubjectModel),
      read: 'academic:read',
      write: 'academic:manage',
      createSchema: subjectCreate,
      updateSchema: subjectUpdate,
      searchFields: ['name', 'code'],
      filterFields: ['isActive'],
      sort: { name: 1 },
      bulk: true,
    }),
  );

  r.use(
    '/teacher-assignments',
    createCrudRouter({
      entity: 'TeacherAssignment',
      model: asModel(TeacherAssignmentModel),
      read: 'academic:read',
      write: 'academic:manage',
      createSchema: assignmentCreate,
      updateSchema: assignmentUpdate,
      filterFields: ['academicSession', 'class', 'section', 'subject', 'teacher', 'isActive'],
      populate: [
        { path: 'class', select: 'name' },
        { path: 'section', select: 'name' },
        { path: 'subject', select: 'name code' },
        { path: 'teacher', select: 'fullName employeeCode' },
      ],
      sort: { createdAt: -1 },
      bulk: true,
      hooks: {
        async scope(req) {
          return req.user?.role === 'TEACHER' ? { teacher: req.user.id } : {};
        },
        async beforeCreate(data) {
          const section = await SectionModel.findById(String(data.section)).lean();
          if (!section) throw badRequest('Section not found');
          const session = await resolveSessionId(data.academicSession ?? String(section.academicSession));
          if (session !== String(section.academicSession)) throw badRequest('Section does not belong to the academic session');
          if (!(await SubjectModel.exists({ _id: String(data.subject), isActive: true }))) throw badRequest('Subject not found or inactive');
          await ensureTeacher(data.teacher);
          return { ...data, academicSession: session, class: section.class };
        },
        async beforeUpdate(data) {
          await ensureTeacher(data.teacher);
          return data;
        },
      },
    }),
  );

  return r;
}
