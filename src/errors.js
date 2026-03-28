/**
 * errors.js — 统一错误处理
 *
 * 提供：
 * 1. CLI 退出码常量（与 exit-codes.mjs 保持一致）
 * 2. 可抛出的业务错误类（用于真正的异常情况）
 * 3. 错误码枚举（用于 { ok: false, error: '...' } 结果对象）
 */

// ── CLI 退出码 ──────────────────────────────────────────
export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  INVALID_ARGS: 2,
  AUTH_FAILURE: 3,
  BROWSER_STARTUP_FAILURE: 4,
  SELECTOR_FAILURE: 5,
  TIMEOUT: 6,
  INTERRUPTED: 7,
  INTERNAL_ERROR: 8,
});

// ── 错误码枚举（用于结果对象）─────────────────────────────
export const ERROR_CODES = Object.freeze({
  // 操作失败类（expected failures，返回 { ok: false, error: '...' }）
  ELEMENT_NOT_FOUND: 'element_not_found',
  TIMEOUT: 'timeout',
  INVALID_ARGS: 'invalid_args',
  AUTH_FAILURE: 'auth_failure',
  BROWSER_STARTUP_FAILURE: 'browser_startup_failure',
  SELECTOR_FAILURE: 'selector_failure',
  INTERNAL_ERROR: 'internal_error',

  // Gemini-ops 特定错误
  UNKNOWN_KEY: 'unknown_key',
  TEMP_CHAT_BTN_NOT_FOUND: 'temp_chat_btn_not_found',
  UNKNOWN_MODEL: 'unknown_model',
  MODEL_MENU_OPEN_FAILED: 'model_menu_open_failed',
  NO_RESPONSES: 'no_responses',
  NO_LOADED_IMAGES: 'no_loaded_images',
  MISSING_URL: 'missing_url',
  CANVAS_TAINTED: 'canvas_tainted',
  FETCH_FAILED: 'fetch_failed',
  CDP_REQUEST_FAILED: 'cdp_request_failed',
  CDP_NO_STREAM: 'cdp_no_stream',
  CDP_ERROR: 'cdp_error',
  INDEX_OUT_OF_RANGE: 'index_out_of_range',
  EMPTY_IMAGE_SRC: 'empty_image_src',
  INVALID_DATA_URL: 'invalid_data_url',
  BLOB_EXTRACT_FAILED: 'blob_extract_failed',
  RELOAD_FAILED: 'reload_failed',
  NAVIGATE_FAILED: 'navigate_failed',
  FILE_NOT_FOUND: 'file_not_found',
  UPLOAD_PANEL_CLICK_FAILED: 'upload_panel_click_failed',
  UPLOAD_IMAGE_FAILED: 'upload_image_failed',
  FILL_FAILED: 'fill_failed',
  SEND_CLICK_FAILED: 'send_click_failed',
  NO_IMAGE_FOUND: 'no_image_found',
  ELEMENT_LOST_AFTER_CLICK: 'element_lost_after_click',
  INVALID_DOMAIN: 'invalid_domain',

  // Watermark remover
  INVALID_IMAGE_METADATA: 'invalid_image_metadata',
});

// ── 错误码到退出码的映射 ────────────────────────────────
const ERROR_TO_EXIT_CODE = Object.freeze({
  [ERROR_CODES.INVALID_ARGS]: EXIT_CODES.INVALID_ARGS,
  [ERROR_CODES.AUTH_FAILURE]: EXIT_CODES.AUTH_FAILURE,
  [ERROR_CODES.BROWSER_STARTUP_FAILURE]: EXIT_CODES.BROWSER_STARTUP_FAILURE,
  [ERROR_CODES.SELECTOR_FAILURE]: EXIT_CODES.SELECTOR_FAILURE,
  [ERROR_CODES.TIMEOUT]: EXIT_CODES.TIMEOUT,
  [ERROR_CODES.INTERNAL_ERROR]: EXIT_CODES.INTERNAL_ERROR,
});

/**
 * 根据错误码获取对应的 CLI 退出码
 * @param {string} errorCode
 * @returns {number}
 */
export function errorCodeToExitCode(errorCode) {
  return ERROR_TO_EXIT_CODE[errorCode] ?? EXIT_CODES.INTERNAL_ERROR;
}

// ── 可抛出的业务错误类 ─────────────────────────────────

/**
 * 基础业务错误类
 * 所有需要抛出而非返回结果的错误使用此类
 */
export class OperationalError extends Error {
  /**
   * @param {string} message
   * @param {{ code: string, exitCode?: number, detail?: any }} options
   */
  constructor(message, { code, exitCode = EXIT_CODES.INTERNAL_ERROR, detail = null } = {}) {
    super(message);
    this.name = 'OperationalError';
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      exitCode: this.exitCode,
      detail: this.detail,
    };
  }
}

export class BrowserNotFoundError extends OperationalError {
  constructor(message = '未找到可用浏览器', detail = null) {
    super(message, { code: 'BROWSER_NOT_FOUND', exitCode: EXIT_CODES.BROWSER_STARTUP_FAILURE, detail });
    this.name = 'BrowserNotFoundError';
  }
}

export class DaemonStartupError extends OperationalError {
  constructor(message = 'Daemon 启动失败', detail = null) {
    super(message, { code: 'DAEMON_STARTUP_FAILED', exitCode: EXIT_CODES.BROWSER_STARTUP_FAILURE, detail });
    this.name = 'DaemonStartupError';
  }
}

export class DaemonConnectionError extends OperationalError {
  constructor(message = 'Daemon 连接失败', detail = null) {
    super(message, { code: 'DAEMON_CONNECTION_FAILED', exitCode: EXIT_CODES.BROWSER_STARTUP_FAILURE, detail });
    this.name = 'DaemonConnectionError';
  }
}

export class InvalidArgumentError extends OperationalError {
  constructor(message, detail = null) {
    super(message, { code: 'INVALID_ARGUMENT', exitCode: EXIT_CODES.INVALID_ARGS, detail });
    this.name = 'InvalidArgumentError';
  }
}

export class AuthenticationError extends OperationalError {
  constructor(message = '认证失败', detail = null) {
    super(message, { code: 'AUTH_FAILURE', exitCode: EXIT_CODES.AUTH_FAILURE, detail });
    this.name = 'AuthenticationError';
  }
}

// ── 辅助函数 ────────────────────────────────────────────

/**
 * 判断是否为 OperationalError
 * @param {any} err
 * @returns {boolean}
 */
export function isOperationalError(err) {
  return err instanceof OperationalError;
}

/**
 * 安全获取错误码（无论是 Error 对象还是字符串）
 * @param {Error|string} err
 * @returns {string}
 */
export function getErrorCode(err) {
  if (typeof err === 'string') return err;
  if (err instanceof OperationalError) return err.code;
  if (err instanceof Error) return err.message;
  return String(err);
}
