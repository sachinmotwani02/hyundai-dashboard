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

        // Add visual feedback to the checklist item
        const item = e.target.closest('.checklist-item');
        if (e.target.checked) {
            item.style.background = '#f0fdf7';
            item.style.borderColor = '#00d6a3';
        } else {
            item.style.background = '#ffffff';
            item.style.borderColor = '#e5e8eb';
        }
    });
});

// Initialize on page load
updateCompletedCount();

console.log('Hyundai Quality Control Dashboard Initialized');
console.log(`Total Checkboxes: ${totalCheckboxes}`);
