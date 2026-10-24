ALTER TABLE backend_reservation_commands
  DROP CONSTRAINT backend_reservation_commands_operation_check,
  ADD CONSTRAINT backend_reservation_commands_operation_check
    CHECK (operation IN ('create', 'cancel', 'update_guests'));
