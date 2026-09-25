export const formatStatus = (status: string) => {
  switch (status) {
    case "Open":
      return "Open";
    case "In_Progress":
      return "In Progress";
    case "Resolved":
      return "Resolved";
    case "Closed":
      return "Closed";
  }
};
