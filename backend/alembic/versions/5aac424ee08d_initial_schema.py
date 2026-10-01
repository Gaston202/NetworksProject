"""initial schema (three-role scope)

Revision ID: 5aac424ee08d
Revises:
Create Date: 2026-09-25 12:22:51.240879

Sqashed in place 2026-10-01 to the reduced schema (ADR-0008 as cut):
no vitals, no pharmacy tables, no invoice line items; UserRole is now
admin/doctor/patient (ADR-0007). Nothing was ever deployed, so the initial
revision was rewritten rather than extended with a drop migration.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = '5aac424ee08d'
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table('departments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('full_name', sa.String(length=120), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('role', sa.Enum('admin', 'doctor', 'patient', name='user_role', native_enum=False, length=20), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('doctor_profiles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('department_id', sa.Integer(), nullable=True),
    sa.Column('specialty', sa.String(length=120), nullable=True),
    sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('patient_profiles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('date_of_birth', sa.Date(), nullable=True),
    sa.Column('phone', sa.String(length=30), nullable=True),
    sa.Column('address', sa.String(length=255), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('availability_slots',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('doctor_id', sa.Integer(), nullable=False),
    sa.Column('starts_at', sa.DateTime(), nullable=False),
    sa.Column('ends_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['doctor_id'], ['doctor_profiles.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_availability_slots_doctor_id'), 'availability_slots', ['doctor_id'], unique=False)
    op.create_index(op.f('ix_availability_slots_starts_at'), 'availability_slots', ['starts_at'], unique=False)
    op.create_table('appointments',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('slot_id', sa.Integer(), nullable=False),
    sa.Column('patient_id', sa.Integer(), nullable=False),
    sa.Column('doctor_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('booked', 'consulted', 'completed', 'cancelled', 'no_show', name='appointment_status', native_enum=False, length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['doctor_id'], ['doctor_profiles.id'], ),
    sa.ForeignKeyConstraint(['patient_id'], ['patient_profiles.id'], ),
    sa.ForeignKeyConstraint(['slot_id'], ['availability_slots.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    # One *active* appointment per slot: uniqueness excludes cancelled rows so
    # cancellation frees the slot for rebooking (ADR-0009 invariant 1).
    op.create_index('uq_appointments_active_slot', 'appointments', ['slot_id'], unique=True,
    sqlite_where=sa.text("status <> 'cancelled'"),
    postgresql_where=sa.text("status <> 'cancelled'"))
    op.create_index(op.f('ix_appointments_doctor_id'), 'appointments', ['doctor_id'], unique=False)
    op.create_index(op.f('ix_appointments_patient_id'), 'appointments', ['patient_id'], unique=False)
    op.create_table('consultations',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('appointment_id', sa.Integer(), nullable=False),
    sa.Column('diagnosis', sa.Text(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('prescription', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('appointment_id', name='uq_consultations_appointment')
    )
    op.create_index(op.f('ix_consultations_appointment_id'), 'consultations', ['appointment_id'], unique=True)
    op.create_table('invoices',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('appointment_id', sa.Integer(), nullable=False),
    sa.Column('total', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('status', sa.Enum('unpaid', 'paid', name='invoice_status', native_enum=False, length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['appointment_id'], ['appointments.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('appointment_id', name='uq_invoices_appointment')
    )
    op.create_index(op.f('ix_invoices_appointment_id'), 'invoices', ['appointment_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_invoices_appointment_id'), table_name='invoices')
    op.drop_table('invoices')
    op.drop_index(op.f('ix_consultations_appointment_id'), table_name='consultations')
    op.drop_table('consultations')
    op.drop_index(op.f('ix_appointments_patient_id'), table_name='appointments')
    op.drop_index(op.f('ix_appointments_doctor_id'), table_name='appointments')
    op.drop_index('uq_appointments_active_slot', table_name='appointments')
    op.drop_table('appointments')
    op.drop_index(op.f('ix_availability_slots_starts_at'), table_name='availability_slots')
    op.drop_index(op.f('ix_availability_slots_doctor_id'), table_name='availability_slots')
    op.drop_table('availability_slots')
    op.drop_table('patient_profiles')
    op.drop_table('doctor_profiles')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('departments')