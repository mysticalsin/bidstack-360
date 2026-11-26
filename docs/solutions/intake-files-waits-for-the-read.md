# Intake files wait for the read

The intake receive step opens after an account is chosen and before `GET /api/files` returns. A paused or in-flight read has `data === undefined` and `isLoading` false. The step still showed the upload dropzone and a blank file list. A failed status with `isError` still false kept a stale file name. A settled null payload fell through the empty check and looked blank.

`intakeFilesPhase` reports `unread`, `failed`, or `ready`. Error wins, then undefined data is unread, else the read is ready. Unread says the file list has not arrived and does not offer the dropzone. Failed says "Failed to load files" and drops a stale name. A settled empty list, including a null payload, still says there are no documents. A file that arrived still shows. Choosing an account is not a file read, so the picker stays until an account is selected.

The account picker, the upload mutation, and the extract, review, and publish steps are unchanged.
