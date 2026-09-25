export const getPriorityClass = (priority: string) => {
  switch (priority) {
    case "High":
      return "text-red-600 font-bold";
    case "Medium":
      return "text-yellow-600 font-bold";
    case "Low":
      return "text-green-600 font-bold";
  }
};

export const getStatusClass = (status: string) => {
  switch (status) {
    case "Open":
      return "text-red-600 font-bold";
    case "In_Progress":
      return "text-blue-600 font-bold";
    case "Resolved":
      return "text-green-600 font-bold";
    case "Closed":
      return "text-gray-600 font-bold";
  }
};
