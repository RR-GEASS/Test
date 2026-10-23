export async function api(path, body, method = body ? "POST" : "GET") {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      "Le serveur est inaccessible. Vos modifications restent dans cet onglet ; réessayez ou exportez une sauvegarde.",
    );
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      "Le serveur ne répond pas correctement. Vérifiez que le serveur Node.js est démarré.",
    );
  }
  if (!response.ok) {
    const error = new Error(result.error || "La requête a échoué.");
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result;
}
