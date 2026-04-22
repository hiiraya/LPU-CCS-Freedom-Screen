import { supabase } from "./supabaseClient.js";

const MESSAGE_SELECT_PROFILES = [
  "id,text,created_at,language,full_code,is_deleted,pos_x,pos_y,rotation",
  "id,text,created_at,language,full_code,is_deleted",
  "id,text,created_at,language",
  "id,text,created_at",
];

const MESSAGE_INSERT_PROFILES = [
  ["text", "full_code", "language", "pos_x", "pos_y", "rotation"],
  ["text", "full_code", "language"],
  ["text", "language"],
  ["text"],
];

function normalizeSupabaseError(error, fallbackMessage) {
  if (!error) return null;

  const message = String(error.message ?? "").trim();
  const lowered = message.toLowerCase();

  if (!message) {
    return new Error(fallbackMessage);
  }

  if (lowered.includes("fetch failed") || lowered.includes("networkerror")) {
    return new Error("Supabase is unreachable right now. Check the project URL, key, and network connection.");
  }

  if (lowered.includes("row-level security")) {
    return new Error("Supabase blocked this request. Re-run the SQL in supabase/messages_security.sql to restore the required policies and RPC functions.");
  }

  if (lowered.includes("char_length") || lowered.includes("messages_public_insert")) {
    return new Error("Wall entries must contain visible text and stay within the allowed length.");
  }

  if (lowered.includes("could not find the function public.admin_")) {
    return new Error("Admin actions are not installed yet. Run supabase/messages_security.sql in Supabase, then try again.");
  }

  return new Error(message);
}

function pickPayload(source, keys) {
  return keys.reduce((payload, key) => {
    if (source[key] !== undefined) {
      payload[key] = source[key];
    }
    return payload;
  }, {});
}

export async function fetchMessagesWithFallback(limit) {
  let lastError = null;

  for (const select of MESSAGE_SELECT_PROFILES) {
    const query = await supabase
      .from("messages")
      .select(select)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!query.error) {
      return {
        data: query.data ?? [],
        select,
        error: null,
      };
    }

    lastError = normalizeSupabaseError(query.error, "Unable to load wall entries from Supabase.");
  }

  return {
    data: [],
    select: null,
    error: lastError,
  };
}

export async function fetchAllMessagesForExport() {
  const query = await supabase
    .from("messages")
    .select("*")
    .order("created_at", { ascending: true });

  return {
    data: query.data ?? [],
    error: query.error
      ? normalizeSupabaseError(query.error, "Unable to load wall data for export.")
      : null,
  };
}

export async function insertMessageWithFallback(message) {
  let lastError = null;

  for (const keys of MESSAGE_INSERT_PROFILES) {
    const payload = pickPayload(message, keys);
    const result = await supabase.from("messages").insert([payload]);

    if (!result.error) {
      return {
        error: null,
        insertedKeys: keys,
      };
    }

    lastError = normalizeSupabaseError(result.error, "Unable to save the wall entry to Supabase.");
  }

  return {
    error: lastError,
    insertedKeys: [],
  };
}

export async function verifyAdminPassword(password) {
  const trimmedPassword = String(password ?? "").trim();

  if (!trimmedPassword) {
    return {
      error: new Error("Enter the admin password first."),
      isValid: false,
    };
  }

  const result = await supabase.rpc("admin_login", {
    admin_password: trimmedPassword,
  });

  if (result.error) {
    return {
      error: normalizeSupabaseError(result.error, "Unable to verify the admin password."),
      isValid: false,
    };
  }

  if (!result.data) {
    return {
      error: new Error("The admin password was not accepted."),
      isValid: false,
    };
  }

  return {
    error: null,
    isValid: true,
  };
}

export async function deleteAllMessagesWithAdminPassword(password) {
  const trimmedPassword = String(password ?? "").trim();

  if (!trimmedPassword) {
    return {
      deletedCount: 0,
      error: new Error("Enter the admin password first."),
    };
  }

  const result = await supabase.rpc("admin_delete_all_messages", {
    admin_password: trimmedPassword,
  });

  return {
    deletedCount: Number(result.data ?? 0),
    error: result.error
      ? normalizeSupabaseError(result.error, "Unable to delete wall entries.")
      : null,
  };
}
