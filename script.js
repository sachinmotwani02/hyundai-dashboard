// DOM Elements
const checkboxes = document.querySelectorAll('.checkbox');

// Initialize
let totalCheckboxes = checkboxes.length;

// Update completed count
function updateCompletedCount() {
    const checkedCount = document.querySelectorAll('.checkbox:checked').length;
    console.log(`Checked: ${checkedCount}/${totalCheckboxes}`);
}

// Handle checkbox change
checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
        updateCompletedCount();
    });
});

// Initialize on page load
updateCompletedCount();

console.log('Hyundai Quality Control Dashboard Initialized');
console.log(`Total Checkboxes: ${totalCheckboxes}`);
